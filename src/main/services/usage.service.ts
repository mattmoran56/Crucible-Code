import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir, platform } from 'node:os'
import { execSync } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { SessionUsage, UsageStats, SubscriptionInfo, DailyActivity, UsageLimitEvent } from '../../shared/types'

// 5h limit considered "reached" at this fill percentage. Slightly under 100%
// so the auto-continue toast surfaces just before Claude starts rejecting
// prompts, not after.
const LIMIT_THRESHOLD_PCT = 95

// Map of sessionId → temp file path for statusLine JSON output
const sessionFiles = new Map<string, string>()
// Latest parsed usage per session
const sessionUsages = new Map<string, SessionUsage>()

let pollTimer: ReturnType<typeof setInterval> | null = null
let mainWindow: BrowserWindow | null = null

/**
 * Get the deterministic temp file path for a session's statusLine output.
 */
export function getUsageTempPath(sessionId: string): string {
  return join(tmpdir(), `codecrucible-usage-${sessionId}.json`)
}

/**
 * Register a session so its usage temp file gets polled.
 */
export function registerSession(sessionId: string): void {
  sessionFiles.set(sessionId, getUsageTempPath(sessionId))
}

/**
 * Unregister a session and clean up its temp file.
 */
export function unregisterSession(sessionId: string): void {
  const filePath = sessionFiles.get(sessionId)
  sessionFiles.delete(sessionId)
  sessionUsages.delete(sessionId)
  if (filePath) {
    try {
      unlinkSync(filePath)
    } catch {
      // File may not exist — ignore
    }
  }
}

/**
 * Build a SessionUsage from the raw statusLine JSON body. Shared by the
 * sync (IPC fast-path) and async (poller) readers so the parsing logic
 * stays in one place.
 */
function rawToSessionUsage(sessionId: string, raw: string): SessionUsage | null {
  try {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const data = JSON.parse(trimmed)

    const usage: SessionUsage = {
      sessionId,
      cost: {
        totalCostUsd: data.cost?.total_cost_usd ?? 0,
        totalDurationMs: data.cost?.total_duration_ms ?? 0,
        totalApiDurationMs: data.cost?.total_api_duration_ms ?? 0,
        totalLinesAdded: data.cost?.total_lines_added ?? 0,
        totalLinesRemoved: data.cost?.total_lines_removed ?? 0,
      },
      updatedAt: Date.now(),
    }

    if (data.rate_limits) {
      usage.rateLimits = {}
      if (data.rate_limits.five_hour) {
        usage.rateLimits.fiveHour = {
          usedPercentage: data.rate_limits.five_hour.used_percentage ?? 0,
          resetsAt: data.rate_limits.five_hour.resets_at ?? 0,
        }
      }
      if (data.rate_limits.seven_day) {
        usage.rateLimits.sevenDay = {
          usedPercentage: data.rate_limits.seven_day.used_percentage ?? 0,
          resetsAt: data.rate_limits.seven_day.resets_at ?? 0,
        }
      }
    }

    return usage
  } catch {
    return null
  }
}

/**
 * Synchronous parse used by the on-demand IPC path. Kept sync so the IPC
 * handler can return a value immediately when the cache misses; the periodic
 * poller uses the async variant instead.
 */
function parseStatusLineFile(sessionId: string, filePath: string): SessionUsage | null {
  try {
    if (!existsSync(filePath)) return null
    return rawToSessionUsage(sessionId, readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

async function parseStatusLineFileAsync(
  sessionId: string,
  filePath: string
): Promise<SessionUsage | null> {
  try {
    return rawToSessionUsage(sessionId, await readFile(filePath, 'utf-8'))
  } catch {
    // ENOENT (file not yet written) or parse error — silently skip this tick.
    return null
  }
}

/**
 * Skip the poll entirely when the app is hidden or there's nothing to poll.
 * Reading every session's status-line file from the main thread used to be a
 * 50-200ms blocking burst every 30s once a few sessions were active.
 */
function shouldPoll(): boolean {
  if (sessionFiles.size === 0) return false
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMinimized()) return false
  if (!mainWindow.isVisible()) return false
  return true
}

/**
 * Poll all registered session files and push updates to the renderer.
 * Runs reads in parallel and uses async fs so the main thread isn't blocked
 * during the burst.
 */
async function pollAllSessions(): Promise<void> {
  if (!shouldPoll()) return
  const entries = Array.from(sessionFiles.entries())
  const results = await Promise.all(
    entries.map(async ([sessionId, filePath]) => ({
      sessionId,
      usage: await parseStatusLineFileAsync(sessionId, filePath),
    }))
  )
  for (const { sessionId, usage } of results) {
    if (!usage) continue
    const previous = sessionUsages.get(sessionId)
    sessionUsages.set(sessionId, usage)
    mainWindow?.webContents.send(IPC.USAGE_SESSION_UPDATE, usage)
    maybeEmitLimitReached(previous, usage)
  }
}

/**
 * Emit USAGE_LIMIT_REACHED on the rising edge of fiveHour.usedPercentage
 * crossing LIMIT_THRESHOLD_PCT. Fires once per crossing — until usage drops
 * back below the threshold (after the window resets), no new event fires.
 */
function maybeEmitLimitReached(previous: SessionUsage | undefined, current: SessionUsage): void {
  const currentPct = current.rateLimits?.fiveHour?.usedPercentage
  const resetsAt = current.rateLimits?.fiveHour?.resetsAt
  if (currentPct == null || !resetsAt) return
  const previousPct = previous?.rateLimits?.fiveHour?.usedPercentage ?? 0
  const wasFull = previousPct >= LIMIT_THRESHOLD_PCT
  const isFull = currentPct >= LIMIT_THRESHOLD_PCT
  if (!wasFull && isFull) {
    const event: UsageLimitEvent = { sessionId: current.sessionId, resetsAt }
    mainWindow?.webContents.send(IPC.USAGE_LIMIT_REACHED, event)
  }
}

/**
 * Start the polling loop. Call once at app startup.
 */
export function startUsagePolling(window: BrowserWindow): void {
  mainWindow = window
  if (pollTimer) return
  pollTimer = setInterval(() => void pollAllSessions(), 30_000)
}

/**
 * Stop polling and clean up all temp files.
 */
export function stopUsagePolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  for (const [sessionId] of sessionFiles) {
    unregisterSession(sessionId)
  }
}

/**
 * Get the latest usage for a specific session.
 */
export function getSessionUsage(sessionId: string): SessionUsage | null {
  // Try cache first, then re-read file
  const cached = sessionUsages.get(sessionId)
  if (cached && Date.now() - cached.updatedAt < 30_000) return cached

  const filePath = sessionFiles.get(sessionId)
  if (!filePath) return cached ?? null

  const usage = parseStatusLineFile(sessionId, filePath)
  if (usage) sessionUsages.set(sessionId, usage)
  return usage ?? cached ?? null
}

function resolveConfigDir(configDir?: string): string {
  if (!configDir) return join(homedir(), '.claude')
  if (configDir.startsWith('~/')) return join(homedir(), configDir.slice(2))
  return configDir
}

/**
 * Read stats-cache.json for historical usage data.
 */
export function getUsageStats(configDir?: string): UsageStats | null {
  try {
    const statsPath = join(resolveConfigDir(configDir), 'stats-cache.json')
    if (!existsSync(statsPath)) return null
    const raw = readFileSync(statsPath, 'utf-8')
    const data = JSON.parse(raw)

    const dailyActivity: DailyActivity[] = (data.dailyActivity ?? []).map(
      (d: { date: string; messageCount: number; sessionCount: number; toolCallCount: number }) => ({
        date: d.date,
        messageCount: d.messageCount ?? 0,
        sessionCount: d.sessionCount ?? 0,
        toolCallCount: d.toolCallCount ?? 0,
      })
    )

    return {
      dailyActivity,
      totalSessions: data.totalSessions ?? 0,
      totalMessages: data.totalMessages ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * Read subscription info from the config directory's settings.json
 * or fall back to macOS keychain for the default account.
 */
export function getSubscriptionInfo(configDir?: string): SubscriptionInfo {
  // If a custom config dir is specified, read from its settings.json
  if (configDir) {
    try {
      const resolved = resolveConfigDir(configDir)
      const settingsPath = join(resolved, 'settings.json')
      if (existsSync(settingsPath)) {
        const data = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        return {
          subscriptionType: data.subscriptionType ?? null,
          rateLimitTier: data.rateLimitTier ?? null,
        }
      }
    } catch { /* fall through */ }
    return { subscriptionType: null, rateLimitTier: null }
  }

  // Default account: try macOS keychain
  if (platform() !== 'darwin') {
    return { subscriptionType: null, rateLimitTier: null }
  }

  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()
    const data = JSON.parse(raw)
    return {
      subscriptionType: data.claudeAiOauth?.subscriptionType ?? null,
      rateLimitTier: data.claudeAiOauth?.rateLimitTier ?? null,
    }
  } catch {
    return { subscriptionType: null, rateLimitTier: null }
  }
}

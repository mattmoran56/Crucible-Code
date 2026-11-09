import { readFileSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir, platform } from 'node:os'
import { execSync } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { SessionUsage, UsageStats, SubscriptionInfo, DailyActivity } from '../../shared/types'

// Map of sessionId → temp file path for statusLine JSON output
const sessionFiles = new Map<string, string>()
// Latest parsed usage per session
const sessionUsages = new Map<string, SessionUsage>()

/** What one agent tab has spent, as reported by its stream-json `result` lines. */
export interface AgentSpend {
  costUsd: number
  durationMs: number
  apiDurationMs: number
}
// sessionId → agentId → spend. A session can have several agent tabs; its
// cost is their sum.
const streamSpend = new Map<string, Map<string, AgentSpend>>()

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
  streamSpend.delete(sessionId)
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

function parseStatusLineFile(sessionId: string, filePath: string): SessionUsage | null {
  try {
    if (!existsSync(filePath)) return null
    const usage = rawToSessionUsage(sessionId, readFileSync(filePath, 'utf-8'))
    if (!usage) return null
    // Stamp with when Claude wrote it, not when we read it, so a stale file
    // left by an earlier terminal can't overwrite fresher agent-tab data.
    usage.updatedAt = statSync(filePath).mtimeMs
    usage.source = 'statusLine'
    return usage
  } catch {
    return null
  }
}

/**
 * Re-read a session's statusLine file and cache it if it is newer than what we
 * hold. Returns the new usage, or null when nothing changed.
 */
function refreshFromFile(sessionId: string, filePath: string): SessionUsage | null {
  const usage = parseStatusLineFile(sessionId, filePath)
  if (!usage) return null
  const cached = sessionUsages.get(sessionId)
  if (cached && cached.updatedAt >= usage.updatedAt) return null
  // Plan limits are account-wide: keep the last known ones if this file has none.
  if (!usage.rateLimits && cached?.rateLimits) usage.rateLimits = cached.rateLimits
  sessionUsages.set(sessionId, usage)
  return usage
}

function publish(usage: SessionUsage): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.USAGE_SESSION_UPDATE, usage)
}

function emptyUsage(sessionId: string): SessionUsage {
  return {
    sessionId,
    cost: {
      totalCostUsd: 0,
      totalDurationMs: 0,
      totalApiDurationMs: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    updatedAt: Date.now(),
  }
}

/**
 * Record what an agent tab (stream-json, print mode) has spent so far. Print
 * mode never runs the statusLine command, so this is how agent tabs feed the
 * usage panel.
 */
export function reportAgentSpend(sessionId: string, agentId: string, spend: AgentSpend): void {
  let perAgent = streamSpend.get(sessionId)
  if (!perAgent) {
    perAgent = new Map()
    streamSpend.set(sessionId, perAgent)
  }
  perAgent.set(agentId, { ...spend })

  let costUsd = 0
  let durationMs = 0
  let apiDurationMs = 0
  for (const s of perAgent.values()) {
    costUsd += s.costUsd
    durationMs += s.durationMs
    apiDurationMs += s.apiDurationMs
  }
  const prev = sessionUsages.get(sessionId)
  const usage: SessionUsage = {
    sessionId,
    rateLimits: prev?.rateLimits,
    cost: {
      totalCostUsd: costUsd,
      totalDurationMs: durationMs,
      totalApiDurationMs: apiDurationMs,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    },
    source: 'stream',
    updatedAt: Date.now(),
  }
  sessionUsages.set(sessionId, usage)
  publish(usage)
}

/** Record plan limits an agent tab's `rate_limit_event` reported. */
export function reportRateLimits(sessionId: string, limits: NonNullable<SessionUsage['rateLimits']>): void {
  const prev = sessionUsages.get(sessionId) ?? { ...emptyUsage(sessionId), source: 'stream' as const }
  const usage: SessionUsage = {
    ...prev,
    rateLimits: { ...prev.rateLimits, ...limits },
    updatedAt: Date.now(),
  }
  sessionUsages.set(sessionId, usage)
  publish(usage)
}

/**
 * Skip the poll entirely when the app is hidden or there's nothing to poll —
 * the IPC update has no recipient and the disk reads add up over hours of
 * idle background time.
 */
function shouldPoll(): boolean {
  if (sessionFiles.size === 0) return false
  if (!mainWindow || mainWindow.isDestroyed()) return false
  if (mainWindow.isMinimized()) return false
  if (!mainWindow.isVisible()) return false
  return true
}

// Poll only updates the live usage display (rate-limit bars, session stats).
// The continue popup is NOT triggered from these percentages — it fires only
// when terminal.service detects the real "usage limit reached" banner that
// actually blocks a conversation (see detectUsageLimit). Accounts with no hard
// limit cross high percentages without ever being blocked, so a percentage
// threshold would mis-fire for them.
function pollAllSessions(): void {
  if (!shouldPoll()) return
  for (const [sessionId, filePath] of sessionFiles) {
    const usage = refreshFromFile(sessionId, filePath)
    if (usage) publish(usage)
  }
}

/**
 * Start the polling loop. Call once at app startup.
 */
export function startUsagePolling(window: BrowserWindow): void {
  mainWindow = window
  if (pollTimer) return
  pollTimer = setInterval(pollAllSessions, 30_000)
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
  const filePath = sessionFiles.get(sessionId)
  if (filePath) refreshFromFile(sessionId, filePath)
  return sessionUsages.get(sessionId) ?? null
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

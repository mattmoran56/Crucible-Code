import { readFileSync, existsSync, unlinkSync } from 'node:fs'
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
 * Parse a statusLine JSON file written by Claude Code's statusLine hook.
 */
function parseStatusLineFile(sessionId: string, filePath: string): SessionUsage | null {
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, 'utf-8').trim()
    if (!raw) return null
    const data = JSON.parse(raw)

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
 * Poll all registered session files and push updates to the renderer.
 */
function pollAllSessions(): void {
  for (const [sessionId, filePath] of sessionFiles) {
    const usage = parseStatusLineFile(sessionId, filePath)
    if (usage) {
      sessionUsages.set(sessionId, usage)
      mainWindow?.webContents.send(IPC.USAGE_SESSION_UPDATE, usage)
    }
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

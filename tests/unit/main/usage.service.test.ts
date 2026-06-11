import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getSessionUsage,
  getSubscriptionInfo,
  getUsageStats,
  getUsageTempPath,
  registerSession,
  startUsagePolling,
  stopUsagePolling,
  unregisterSession,
} from '../../../src/main/services/usage.service'
import { IPC } from '../../../src/shared/constants'

let configDir: string
let counter = 0

// Each test gets a unique session id so the module-level session maps never
// collide across tests in this file.
function freshSessionId(): string {
  return `cc-usage-test-${process.pid}-${++counter}`
}

function writeStatusLine(sessionId: string, data: unknown): void {
  writeFileSync(getUsageTempPath(sessionId), typeof data === 'string' ? data : JSON.stringify(data))
}

const registered: string[] = []
function register(sessionId: string): void {
  registerSession(sessionId)
  registered.push(sessionId)
}

beforeEach(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'cc-usage-cfg-'))
})

afterEach(async () => {
  stopUsagePolling()
  for (const id of registered.splice(0)) unregisterSession(id)
  vi.useRealTimers()
  await rm(configDir, { recursive: true, force: true })
})

describe('usage.service temp paths + registration', () => {
  it('getUsageTempPath is deterministic and embeds the session id under the OS tmpdir', () => {
    const id = freshSessionId()
    const p = getUsageTempPath(id)
    expect(p).toBe(join(tmpdir(), `codecrucible-usage-${id}.json`))
    expect(getUsageTempPath(id)).toBe(p)
  })

  it('unregisterSession deletes the session temp file', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: { total_cost_usd: 1 } })
    expect(existsSync(getUsageTempPath(id))).toBe(true)
    unregisterSession(id)
    expect(existsSync(getUsageTempPath(id))).toBe(false)
  })

  it('unregisterSession tolerates a session whose file never existed', () => {
    const id = freshSessionId()
    register(id)
    expect(() => unregisterSession(id)).not.toThrow()
  })
})

describe('usage.service getSessionUsage', () => {
  it('parses cost fields from the statusLine JSON', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, {
      cost: {
        total_cost_usd: 1.23,
        total_duration_ms: 4000,
        total_api_duration_ms: 2500,
        total_lines_added: 10,
        total_lines_removed: 3,
      },
    })
    const usage = getSessionUsage(id)
    expect(usage).toMatchObject({
      sessionId: id,
      cost: {
        totalCostUsd: 1.23,
        totalDurationMs: 4000,
        totalApiDurationMs: 2500,
        totalLinesAdded: 10,
        totalLinesRemoved: 3,
      },
    })
  })

  it('defaults missing cost fields to zero', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: {} })
    expect(getSessionUsage(id)?.cost).toEqual({
      totalCostUsd: 0,
      totalDurationMs: 0,
      totalApiDurationMs: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
    })
  })

  it('parses five-hour and seven-day rate limits when present', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, {
      cost: { total_cost_usd: 0 },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: 1700000000 },
        seven_day: { used_percentage: 7, resets_at: 1700600000 },
      },
    })
    const usage = getSessionUsage(id)
    expect(usage?.rateLimits).toEqual({
      fiveHour: { usedPercentage: 42, resetsAt: 1700000000 },
      sevenDay: { usedPercentage: 7, resetsAt: 1700600000 },
    })
  })

  it('omits rateLimits entirely when the statusLine has none', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: { total_cost_usd: 0.5 } })
    expect(getSessionUsage(id)?.rateLimits).toBeUndefined()
  })

  it('returns null for an unregistered session', () => {
    expect(getSessionUsage(freshSessionId())).toBeNull()
  })

  it('returns null when the registered session file does not exist', () => {
    const id = freshSessionId()
    register(id)
    expect(getSessionUsage(id)).toBeNull()
  })

  it('returns null for an empty statusLine file', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, '   ')
    expect(getSessionUsage(id)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, '{not json')
    expect(getSessionUsage(id)).toBeNull()
  })

  it('serves a recent cached value instead of re-reading the file', () => {
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: { total_cost_usd: 1 } })
    expect(getSessionUsage(id)?.cost.totalCostUsd).toBe(1)
    // Update on disk; the < 30s cache should still serve the old value.
    writeStatusLine(id, { cost: { total_cost_usd: 99 } })
    expect(getSessionUsage(id)?.cost.totalCostUsd).toBe(1)
  })
})

describe('usage.service polling + limit events', () => {
  function fakeWindow(sent: Array<{ channel: string; payload: unknown }>) {
    return {
      webContents: {
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      },
    } as never
  }

  it('polls registered sessions every 30s and pushes USAGE_SESSION_UPDATE', () => {
    vi.useFakeTimers()
    const sent: Array<{ channel: string; payload: unknown }> = []
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: { total_cost_usd: 2 } })

    startUsagePolling(fakeWindow(sent))
    expect(sent).toHaveLength(0) // no immediate tick — interval only

    vi.advanceTimersByTime(30_000)
    const update = sent.find((m) => m.channel === IPC.USAGE_SESSION_UPDATE)
    expect(update?.payload).toMatchObject({ sessionId: id, cost: { totalCostUsd: 2 } })
  })

  it('emits USAGE_LIMIT_REACHED on the rising edge of the 95% five-hour threshold', () => {
    vi.useFakeTimers()
    const sent: Array<{ channel: string; payload: unknown }> = []
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, {
      cost: {},
      rate_limits: { five_hour: { used_percentage: 96, resets_at: 1234 } },
    })

    startUsagePolling(fakeWindow(sent))
    vi.advanceTimersByTime(30_000)

    const events = sent.filter((m) => m.channel === IPC.USAGE_LIMIT_REACHED)
    expect(events).toHaveLength(1)
    expect(events[0].payload).toEqual({ sessionId: id, resetsAt: 1234 })
  })

  it('does not re-emit the limit event while usage stays above the threshold', () => {
    vi.useFakeTimers()
    const sent: Array<{ channel: string; payload: unknown }> = []
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, {
      cost: {},
      rate_limits: { five_hour: { used_percentage: 96, resets_at: 99 } },
    })

    startUsagePolling(fakeWindow(sent))
    vi.advanceTimersByTime(30_000)
    writeStatusLine(id, {
      cost: {},
      rate_limits: { five_hour: { used_percentage: 98, resets_at: 99 } },
    })
    vi.advanceTimersByTime(30_000)

    expect(sent.filter((m) => m.channel === IPC.USAGE_LIMIT_REACHED)).toHaveLength(1)
  })

  it('re-arms the limit event after usage drops below the threshold and rises again', () => {
    vi.useFakeTimers()
    const sent: Array<{ channel: string; payload: unknown }> = []
    const id = freshSessionId()
    register(id)
    const limits = (pct: number) => ({
      cost: {},
      rate_limits: { five_hour: { used_percentage: pct, resets_at: 7 } },
    })

    startUsagePolling(fakeWindow(sent))
    writeStatusLine(id, limits(97))
    vi.advanceTimersByTime(30_000)
    writeStatusLine(id, limits(10)) // window reset
    vi.advanceTimersByTime(30_000)
    writeStatusLine(id, limits(96)) // second crossing
    vi.advanceTimersByTime(30_000)

    expect(sent.filter((m) => m.channel === IPC.USAGE_LIMIT_REACHED)).toHaveLength(2)
  })

  it('stays below threshold → never emits a limit event', () => {
    vi.useFakeTimers()
    const sent: Array<{ channel: string; payload: unknown }> = []
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, {
      cost: {},
      rate_limits: { five_hour: { used_percentage: 94, resets_at: 1 } },
    })
    startUsagePolling(fakeWindow(sent))
    vi.advanceTimersByTime(60_000)
    expect(sent.filter((m) => m.channel === IPC.USAGE_LIMIT_REACHED)).toHaveLength(0)
  })

  it('stopUsagePolling unregisters all sessions and deletes their files', () => {
    vi.useFakeTimers()
    const id = freshSessionId()
    register(id)
    writeStatusLine(id, { cost: {} })
    startUsagePolling(fakeWindow([]))
    stopUsagePolling()
    expect(existsSync(getUsageTempPath(id))).toBe(false)
    expect(getSessionUsage(id)).toBeNull()
  })
})

describe('usage.service getUsageStats', () => {
  it('reads stats-cache.json from a custom config dir', async () => {
    await writeFile(
      join(configDir, 'stats-cache.json'),
      JSON.stringify({
        dailyActivity: [
          { date: '2026-06-01', messageCount: 5, sessionCount: 2, toolCallCount: 9 },
        ],
        totalSessions: 12,
        totalMessages: 340,
      })
    )
    expect(getUsageStats(configDir)).toEqual({
      dailyActivity: [
        { date: '2026-06-01', messageCount: 5, sessionCount: 2, toolCallCount: 9 },
      ],
      totalSessions: 12,
      totalMessages: 340,
    })
  })

  it('defaults missing counters to zero', async () => {
    await writeFile(
      join(configDir, 'stats-cache.json'),
      JSON.stringify({ dailyActivity: [{ date: '2026-06-02' }] })
    )
    expect(getUsageStats(configDir)).toEqual({
      dailyActivity: [
        { date: '2026-06-02', messageCount: 0, sessionCount: 0, toolCallCount: 0 },
      ],
      totalSessions: 0,
      totalMessages: 0,
    })
  })

  it('returns null when stats-cache.json is absent', () => {
    expect(getUsageStats(configDir)).toBeNull()
  })

  it('returns null for malformed stats JSON', async () => {
    await writeFile(join(configDir, 'stats-cache.json'), 'nope{')
    expect(getUsageStats(configDir)).toBeNull()
  })
})

describe('usage.service getSubscriptionInfo', () => {
  it('reads subscription fields from settings.json in a custom config dir', async () => {
    await writeFile(
      join(configDir, 'settings.json'),
      JSON.stringify({ subscriptionType: 'max', rateLimitTier: 'tier-20x' })
    )
    expect(getSubscriptionInfo(configDir)).toEqual({
      subscriptionType: 'max',
      rateLimitTier: 'tier-20x',
    })
  })

  it('returns nulls when the custom config dir has no settings.json', () => {
    expect(getSubscriptionInfo(configDir)).toEqual({
      subscriptionType: null,
      rateLimitTier: null,
    })
  })

  it('returns nulls for malformed settings.json', async () => {
    await writeFile(join(configDir, 'settings.json'), '!!')
    expect(getSubscriptionInfo(configDir)).toEqual({
      subscriptionType: null,
      rateLimitTier: null,
    })
  })

  it('returns nulls for the default account on non-macOS platforms (no keychain)', () => {
    // This suite runs on Linux, so the darwin keychain branch is skipped.
    expect(getSubscriptionInfo()).toEqual({ subscriptionType: null, rateLimitTier: null })
  })
})

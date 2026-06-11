import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsagePanel } from '../../../../src/renderer/components/usage/UsagePanel'
import { useUsageStore } from '../../../../src/renderer/stores/usageStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import type { SessionUsage } from '../../../../src/shared/types'

const NOW_SEC = Math.floor(Date.now() / 1000)

function makeUsage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  return {
    sessionId: 's1',
    rateLimits: {
      fiveHour: { usedPercentage: 42, resetsAt: NOW_SEC + 3660 },
      sevenDay: { usedPercentage: 12, resetsAt: NOW_SEC + 86_400 },
    },
    cost: {
      totalCostUsd: 1.23456,
      totalDurationMs: 65 * 60_000,
      totalApiDurationMs: 0,
      totalLinesAdded: 10,
      totalLinesRemoved: 2,
    },
    updatedAt: Date.now(),
    ...overrides,
  }
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

let fetchStats: ReturnType<typeof vi.fn>
let fetchSubscription: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchStats = vi.fn()
  fetchSubscription = vi.fn()
  useUsageStore.setState({
    sessionUsages: {},
    stats: null,
    subscription: null,
    statsLoading: false,
    fetchStats,
    fetchSubscription,
  } as any)
  useSessionStore.setState({ activeSessionId: null })
})

describe('UsagePanel', () => {
  it('fetches stats and subscription on mount', () => {
    render(<UsagePanel />)
    expect(fetchStats).toHaveBeenCalledTimes(1)
    expect(fetchSubscription).toHaveBeenCalledTimes(1)
  })

  it('renders the Rate Limits heading', () => {
    render(<UsagePanel />)
    expect(screen.getByText('Rate Limits')).toBeInTheDocument()
  })

  it('omits the subscription badge when no subscription is loaded', () => {
    render(<UsagePanel />)
    expect(screen.queryByText('Max')).not.toBeInTheDocument()
  })

  it('shows the subscription badge when a subscription type exists', () => {
    useUsageStore.setState({ subscription: { subscriptionType: 'Max', rateLimitTier: null } })
    render(<UsagePanel />)
    expect(screen.getByText('Max')).toBeInTheDocument()
  })

  it('shows "no data" placeholders when there is no active usage', () => {
    render(<UsagePanel />)
    expect(screen.getByText('5-hour: no data')).toBeInTheDocument()
    expect(screen.getByText('7-day: no data')).toBeInTheDocument()
  })

  it('renders both rate limit bars when the active session has usage', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({ sessionUsages: { s1: makeUsage() } })
    render(<UsagePanel />)
    expect(screen.getByText('5-hour window')).toBeInTheDocument()
    expect(screen.getByText('7-day window')).toBeInTheDocument()
  })

  it('rounds and displays the used percentage', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({ sessionUsages: { s1: makeUsage() } })
    render(<UsagePanel />)
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('12%')).toBeInTheDocument()
  })

  it('clamps the percentage to 100', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          rateLimits: { fiveHour: { usedPercentage: 250, resetsAt: NOW_SEC + 60 } },
        }),
      },
    })
    render(<UsagePanel />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('shows hours and minutes until reset', () => {
    // 1h 1m 30s from a test-time "now" — mid-minute so elapsed milliseconds
    // between setState and render can't flip the floored minute.
    const nowSec = Math.floor(Date.now() / 1000)
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          rateLimits: {
            fiveHour: { usedPercentage: 42, resetsAt: nowSec + 3690 },
            sevenDay: { usedPercentage: 12, resetsAt: nowSec + 86_400 },
          },
        }),
      },
    })
    render(<UsagePanel />)
    expect(screen.getByText('resets in 1h 1m')).toBeInTheDocument()
  })

  it('shows minutes only for sub-hour resets and "now" for past resets', () => {
    // Compute "now" at test time (not module load) and aim for the middle of
    // a minute so wall-clock drift between setState and render can't flip the
    // floored minute count.
    const nowSec = Math.floor(Date.now() / 1000)
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          rateLimits: {
            fiveHour: { usedPercentage: 10, resetsAt: nowSec + 510 },
            sevenDay: { usedPercentage: 10, resetsAt: nowSec - 10 },
          },
        }),
      },
    })
    render(<UsagePanel />)
    expect(screen.getByText('resets in 8m')).toBeInTheDocument()
    expect(screen.getByText('resets in now')).toBeInTheDocument()
  })

  it('colors high usage with the danger variable', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          rateLimits: { fiveHour: { usedPercentage: 90, resetsAt: NOW_SEC + 60 } },
        }),
      },
    })
    render(<UsagePanel />)
    expect((screen.getByText('90%') as HTMLElement).style.color).toBe('var(--color-danger)')
  })

  it('colors mid usage with the warning variable', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          rateLimits: { fiveHour: { usedPercentage: 60, resetsAt: NOW_SEC + 60 } },
        }),
      },
    })
    render(<UsagePanel />)
    expect((screen.getByText('60%') as HTMLElement).style.color).toBe('var(--color-warning)')
  })

  it('colors low usage with the success variable', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({ sessionUsages: { s1: makeUsage() } })
    render(<UsagePanel />)
    expect((screen.getByText('42%') as HTMLElement).style.color).toBe('var(--color-success)')
  })

  it('says "No active session" when nothing is selected', () => {
    render(<UsagePanel />)
    expect(screen.getByText('No active session')).toBeInTheDocument()
  })

  it('says "Waiting for data..." when a session is active but has no usage yet', () => {
    useSessionStore.setState({ activeSessionId: 's-without-usage' })
    render(<UsagePanel />)
    expect(screen.getByText('Waiting for data...')).toBeInTheDocument()
  })

  it('formats the active session cost to four decimals', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({ sessionUsages: { s1: makeUsage() } })
    render(<UsagePanel />)
    expect(screen.getByText('$1.2346')).toBeInTheDocument()
  })

  it('formats the session duration with hours and lines added/removed', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({ sessionUsages: { s1: makeUsage() } })
    render(<UsagePanel />)
    expect(screen.getByText('1h 5m')).toBeInTheDocument()
    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('-2')).toBeInTheDocument()
  })

  it('formats sub-hour durations in minutes', () => {
    useSessionStore.setState({ activeSessionId: 's1' })
    useUsageStore.setState({
      sessionUsages: {
        s1: makeUsage({
          cost: {
            totalCostUsd: 0,
            totalDurationMs: 42 * 60_000,
            totalApiDurationMs: 0,
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
          },
        }),
      },
    })
    render(<UsagePanel />)
    expect(screen.getByText('42m')).toBeInTheDocument()
  })

  it('shows "Loading..." while stats are loading', () => {
    useUsageStore.setState({ statsLoading: true })
    render(<UsagePanel />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows "No stats available" when stats are missing', () => {
    render(<UsagePanel />)
    expect(screen.getByText('No stats available')).toBeInTheDocument()
  })

  it('sums only the last 7 days of activity', () => {
    useUsageStore.setState({
      stats: {
        dailyActivity: [
          { date: isoDaysAgo(1), messageCount: 100, sessionCount: 2, toolCallCount: 30 },
          { date: isoDaysAgo(3), messageCount: 50, sessionCount: 1, toolCallCount: 20 },
          { date: isoDaysAgo(30), messageCount: 9999, sessionCount: 99, toolCallCount: 999 },
        ],
        totalSessions: 0,
        totalMessages: 0,
      },
    })
    render(<UsagePanel />)
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument() // messages
    expect(screen.getByText('3')).toBeInTheDocument() // sessions
    expect(screen.getByText('50')).toBeInTheDocument() // tool calls
    expect(screen.queryByText('10,099')).not.toBeInTheDocument()
  })

  it('labels the weekly stat boxes', () => {
    useUsageStore.setState({
      stats: { dailyActivity: [], totalSessions: 0, totalMessages: 0 },
    })
    render(<UsagePanel />)
    expect(screen.getByText('Messages')).toBeInTheDocument()
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Tool calls')).toBeInTheDocument()
  })
})

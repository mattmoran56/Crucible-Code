import React, { useEffect, useState } from 'react'
import { useUsageStore } from '../../stores/usageStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { RateLimitWindow, DailyActivity } from '../../../shared/types'

function formatTimeUntil(epochSeconds: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = epochSeconds - now
  if (diff <= 0) return 'now'
  const hours = Math.floor(diff / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function barColor(pct: number): string {
  if (pct >= 85) return 'var(--color-danger)'
  if (pct >= 60) return 'var(--color-warning)'
  return 'var(--color-success)'
}

function RateLimitBar({ label, window: w }: { label: string; window: RateLimitWindow }) {
  const pct = Math.min(100, Math.max(0, Math.round(w.usedPercentage)))
  return (
    <div style={{ padding: '0 12px', marginBottom: 12 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
        <span className="text-xs text-text-muted">{label}</span>
        <span className="text-xs text-text-muted">
          resets in {formatTimeUntil(w.resetsAt)}
        </span>
      </div>
      <div
        className="rounded-full overflow-hidden"
        style={{ height: 6, background: 'var(--color-bg-tertiary)' }}
      >
        <div
          className="rounded-full transition-all"
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor(pct),
          }}
        />
      </div>
      <div className="text-right" style={{ marginTop: 2 }}>
        <span className="text-xs font-medium" style={{ color: barColor(pct) }}>
          {pct}%
        </span>
      </div>
    </div>
  )
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function WeekSummary({ dailyActivity }: { dailyActivity: DailyActivity[] }) {
  // Last 7 days
  const now = new Date()
  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const cutoff = sevenDaysAgo.toISOString().slice(0, 10)

  const recent = dailyActivity.filter((d) => d.date >= cutoff)
  const totalMessages = recent.reduce((s, d) => s + d.messageCount, 0)
  const totalSessions = recent.reduce((s, d) => s + d.sessionCount, 0)
  const totalToolCalls = recent.reduce((s, d) => s + d.toolCallCount, 0)

  return (
    <div style={{ padding: '0 12px' }}>
      <div className="text-xs text-text-muted" style={{ marginBottom: 6 }}>
        Last 7 days
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Messages" value={totalMessages.toLocaleString()} />
        <StatBox label="Sessions" value={totalSessions.toLocaleString()} />
        <StatBox label="Tool calls" value={totalToolCalls.toLocaleString()} />
      </div>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded border border-border text-center"
      style={{ padding: '6px 4px' }}
    >
      <div className="text-sm font-medium text-text">{value}</div>
      <div className="text-xs text-text-muted" style={{ marginTop: 2 }}>{label}</div>
    </div>
  )
}

export function UsagePanel() {
  const { sessionUsages, stats, subscription, statsLoading, fetchStats, fetchSubscription } =
    useUsageStore()
  const { activeSessionId } = useSessionStore()

  // Tick every minute to update countdown timers
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Load stats and subscription on mount
  useEffect(() => {
    fetchStats()
    fetchSubscription()
  }, [fetchStats, fetchSubscription])

  const activeUsage = activeSessionId ? sessionUsages[activeSessionId] : null

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* Subscription badge */}
      {subscription?.subscriptionType && (
        <div
          className="flex items-center gap-2 border-b border-border flex-shrink-0"
          style={{ padding: '8px 12px' }}
        >
          <span
            className="text-xs font-medium rounded-full"
            style={{
              padding: '2px 8px',
              background: 'var(--color-accent)',
              color: 'var(--color-bg)',
            }}
          >
            {subscription.subscriptionType}
          </span>
        </div>
      )}

      {/* Rate limits section */}
      <div style={{ paddingTop: 10, paddingBottom: 2 }}>
        <div className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ padding: '0 12px', marginBottom: 8 }}>
          Rate Limits
        </div>

        {activeUsage?.rateLimits?.fiveHour ? (
          <RateLimitBar label="5-hour window" window={activeUsage.rateLimits.fiveHour} />
        ) : (
          <div className="text-xs text-text-muted" style={{ padding: '0 12px', marginBottom: 12 }}>
            5-hour: no data
          </div>
        )}

        {activeUsage?.rateLimits?.sevenDay ? (
          <RateLimitBar label="7-day window" window={activeUsage.rateLimits.sevenDay} />
        ) : (
          <div className="text-xs text-text-muted" style={{ padding: '0 12px', marginBottom: 12 }}>
            7-day: no data
          </div>
        )}
      </div>

      {/* Session cost */}
      <div className="border-t border-border" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ padding: '0 12px', marginBottom: 8 }}>
          Active Session
        </div>

        {activeUsage ? (
          <div style={{ padding: '0 12px' }}>
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Cost" value={formatCost(activeUsage.cost.totalCostUsd)} />
              <StatBox label="Duration" value={formatDuration(activeUsage.cost.totalDurationMs)} />
              <StatBox label="Lines added" value={`+${activeUsage.cost.totalLinesAdded}`} />
              <StatBox label="Lines removed" value={`-${activeUsage.cost.totalLinesRemoved}`} />
            </div>
          </div>
        ) : (
          <div className="text-xs text-text-muted" style={{ padding: '0 12px' }}>
            {activeSessionId ? 'Waiting for data...' : 'No active session'}
          </div>
        )}
      </div>

      {/* Weekly summary */}
      <div className="border-t border-border" style={{ paddingTop: 10, paddingBottom: 10 }}>
        <div className="text-xs font-medium text-text-muted uppercase tracking-wide" style={{ padding: '0 12px', marginBottom: 8 }}>
          This Week
        </div>

        {statsLoading ? (
          <div className="text-xs text-text-muted" style={{ padding: '0 12px' }}>
            Loading...
          </div>
        ) : stats ? (
          <WeekSummary dailyActivity={stats.dailyActivity} />
        ) : (
          <div className="text-xs text-text-muted" style={{ padding: '0 12px' }}>
            No stats available
          </div>
        )}
      </div>
    </div>
  )
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUsageStore } from '../../../src/renderer/stores/usageStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const getSession = vi.fn()
const getStats = vi.fn()
const getSubscription = vi.fn()

beforeEach(() => {
  getSession.mockReset()
  getStats.mockReset()
  getSubscription.mockReset()
  ;(window as any).api = {
    usage: {
      getSession,
      getStats,
      getSubscription,
      onSessionUpdate: () => () => {},
    },
  }
  useUsageStore.setState({ sessionUsages: {}, stats: null, subscription: null, statsLoading: false })
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] } as any)
  useToastStore.setState({ toasts: [] })
})

describe('usageStore.updateSessionUsage', () => {
  it('upserts by sessionId', () => {
    const a: any = { sessionId: 's1', tokens: 10 }
    const b: any = { sessionId: 's1', tokens: 20 }
    const c: any = { sessionId: 's2', tokens: 5 }
    useUsageStore.getState().updateSessionUsage(a)
    useUsageStore.getState().updateSessionUsage(b)
    useUsageStore.getState().updateSessionUsage(c)
    expect(useUsageStore.getState().sessionUsages).toEqual({ s1: b, s2: c })
  })
})

describe('usageStore.fetchSessionUsage', () => {
  it('stores the result on success', async () => {
    const usage: any = { sessionId: 's1', tokens: 7 }
    getSession.mockResolvedValue(usage)
    await useUsageStore.getState().fetchSessionUsage('s1')
    expect(getSession).toHaveBeenCalledWith('s1')
    expect(useUsageStore.getState().sessionUsages).toEqual({ s1: usage })
  })

  it('does nothing when api returns null/undefined', async () => {
    getSession.mockResolvedValue(null)
    await useUsageStore.getState().fetchSessionUsage('s1')
    expect(useUsageStore.getState().sessionUsages).toEqual({})
  })

  it('surfaces errors via toast', async () => {
    getSession.mockRejectedValue(new Error('nope'))
    await useUsageStore.getState().fetchSessionUsage('s1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'nope' })
  })
})

describe('usageStore.fetchStats', () => {
  it('passes the active project account configDir', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/a', claudeAccountId: 'acc-1' } as any],
      activeProjectId: 'p1',
      claudeAccounts: [{ id: 'acc-1', label: 'Personal', configDir: '/cfg' } as any],
    } as any)
    getStats.mockResolvedValue({ daily: [] })
    await useUsageStore.getState().fetchStats()
    expect(getStats).toHaveBeenCalledWith('/cfg')
    expect(useUsageStore.getState().stats).toEqual({ daily: [] })
    expect(useUsageStore.getState().statsLoading).toBe(false)
  })

  it('passes undefined configDir when no active project has an account', async () => {
    getStats.mockResolvedValue({ daily: [] })
    await useUsageStore.getState().fetchStats()
    expect(getStats).toHaveBeenCalledWith(undefined)
  })

  it('clears statsLoading even on error', async () => {
    getStats.mockRejectedValue(new Error('oops'))
    await useUsageStore.getState().fetchStats()
    expect(useUsageStore.getState().statsLoading).toBe(false)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'oops' })
  })
})

describe('usageStore.fetchSubscription', () => {
  it('stores the result on success', async () => {
    getSubscription.mockResolvedValue({ subscriptionType: 'pro' })
    await useUsageStore.getState().fetchSubscription()
    expect(useUsageStore.getState().subscription).toEqual({ subscriptionType: 'pro' })
  })

  it('emits a toast on error', async () => {
    getSubscription.mockRejectedValue('string-error')
    await useUsageStore.getState().fetchSubscription()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error' })
  })
})

describe('usageStore loading and account resolution', () => {
  it('fetchStats flips statsLoading on while the request is in flight', async () => {
    let resolve: (v: any) => void = () => {}
    getStats.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const promise = useUsageStore.getState().fetchStats()
    expect(useUsageStore.getState().statsLoading).toBe(true)
    resolve({ dailyActivity: [], totalSessions: 0, totalMessages: 0 })
    await promise
    expect(useUsageStore.getState().statsLoading).toBe(false)
  })

  it('fetchStats failure keeps the previously fetched stats', async () => {
    const prior: any = { dailyActivity: [], totalSessions: 5, totalMessages: 50 }
    useUsageStore.setState({ stats: prior })
    getStats.mockRejectedValue(new Error('parse error'))
    await useUsageStore.getState().fetchStats()
    expect(useUsageStore.getState().stats).toEqual(prior)
  })

  it('a later fetchStats result replaces the earlier snapshot', async () => {
    getStats
      .mockResolvedValueOnce({ dailyActivity: [], totalSessions: 1, totalMessages: 1 })
      .mockResolvedValueOnce({ dailyActivity: [], totalSessions: 2, totalMessages: 9 })
    await useUsageStore.getState().fetchStats()
    await useUsageStore.getState().fetchStats()
    expect(useUsageStore.getState().stats).toEqual({
      dailyActivity: [],
      totalSessions: 2,
      totalMessages: 9,
    })
  })

  it('fetchSubscription passes the active account configDir', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/a', claudeAccountId: 'acc-1' } as any],
      activeProjectId: 'p1',
      claudeAccounts: [{ id: 'acc-1', label: 'Work', configDir: '/work-cfg' } as any],
    } as any)
    getSubscription.mockResolvedValue({ subscriptionType: 'max', rateLimitTier: 'high' })
    await useUsageStore.getState().fetchSubscription()
    expect(getSubscription).toHaveBeenCalledWith('/work-cfg')
  })

  it('fetchSubscription passes undefined when the project has no linked account', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/a' } as any],
      activeProjectId: 'p1',
      claudeAccounts: [{ id: 'acc-1', label: 'Work', configDir: '/work-cfg' } as any],
    } as any)
    getSubscription.mockResolvedValue(null)
    await useUsageStore.getState().fetchSubscription()
    expect(getSubscription).toHaveBeenCalledWith(undefined)
  })

  it('fetchSubscription stores a null result verbatim', async () => {
    useUsageStore.setState({ subscription: { subscriptionType: 'pro', rateLimitTier: null } as any })
    getSubscription.mockResolvedValue(null)
    await useUsageStore.getState().fetchSubscription()
    expect(useUsageStore.getState().subscription).toBeNull()
  })

  it('fetchSubscription failure keeps the previous subscription', async () => {
    const prior: any = { subscriptionType: 'pro', rateLimitTier: null }
    useUsageStore.setState({ subscription: prior })
    getSubscription.mockRejectedValue(new Error('offline'))
    await useUsageStore.getState().fetchSubscription()
    expect(useUsageStore.getState().subscription).toEqual(prior)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'offline' })
  })

  it('resolves no configDir when the referenced account record is missing', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/a', claudeAccountId: 'acc-deleted' } as any],
      activeProjectId: 'p1',
      claudeAccounts: [],
    } as any)
    getStats.mockResolvedValue({ dailyActivity: [], totalSessions: 0, totalMessages: 0 })
    await useUsageStore.getState().fetchStats()
    expect(getStats).toHaveBeenCalledWith(undefined)
  })

  it('resolves no configDir when activeProjectId matches no project', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/a', claudeAccountId: 'acc-1' } as any],
      activeProjectId: 'p-gone',
      claudeAccounts: [{ id: 'acc-1', label: 'Work', configDir: '/work-cfg' } as any],
    } as any)
    getStats.mockResolvedValue({ dailyActivity: [], totalSessions: 0, totalMessages: 0 })
    await useUsageStore.getState().fetchStats()
    expect(getStats).toHaveBeenCalledWith(undefined)
  })
})

describe('usageStore session usage isolation', () => {
  it('fetchSessionUsage preserves usage entries for other sessions', async () => {
    const existing: any = { sessionId: 'other', cost: { totalCostUsd: 1 } }
    useUsageStore.setState({ sessionUsages: { other: existing } })
    const fetched: any = { sessionId: 's1', cost: { totalCostUsd: 2 } }
    getSession.mockResolvedValue(fetched)
    await useUsageStore.getState().fetchSessionUsage('s1')
    expect(useUsageStore.getState().sessionUsages).toEqual({ other: existing, s1: fetched })
  })

  it('fetchSessionUsage stringifies non-Error rejections for the toast', async () => {
    getSession.mockRejectedValue('socket closed')
    await useUsageStore.getState().fetchSessionUsage('s1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'socket closed',
    })
  })

  it('updateSessionUsage leaves stats and subscription untouched', () => {
    const stats: any = { dailyActivity: [], totalSessions: 1, totalMessages: 2 }
    const subscription: any = { subscriptionType: 'pro', rateLimitTier: null }
    useUsageStore.setState({ stats, subscription })
    useUsageStore.getState().updateSessionUsage({ sessionId: 's1' } as any)
    expect(useUsageStore.getState().stats).toEqual(stats)
    expect(useUsageStore.getState().subscription).toEqual(subscription)
  })
})

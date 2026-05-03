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

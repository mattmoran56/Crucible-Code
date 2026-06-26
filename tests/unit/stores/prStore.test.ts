import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePRStore } from '../../../src/renderer/stores/prStore'

const listPRs = vi.fn()
const getSeenPRs = vi.fn()
const markPRSeen = vi.fn()
const getCurrentUser = vi.fn()
const listCollaborators = vi.fn()
const listLocal = vi.fn(async () => [])

beforeEach(() => {
  for (const fn of [listPRs, getSeenPRs, markPRSeen, getCurrentUser, listCollaborators, listLocal]) fn.mockReset()
  listLocal.mockResolvedValue([])
  ;(window as any).api = {
    github: { listPRs, getSeenPRs, markPRSeen, getCurrentUser, listCollaborators },
    localPr: { list: listLocal },
  }
  usePRStore.setState({
    prCache: {},
    localPRCache: {},
    seenCache: {},
    collaboratorsCache: {},
    currentRepoPath: null,
    currentProjectId: null,
    remotePRs: [],
    localPRs: [],
    pullRequests: [],
    seenPRs: [],
    loading: false,
    hasLoaded: false,
    currentUser: null,
  })
})

const PR = (n: number) => ({ number: n } as any)

describe('prStore.loadPRs', () => {
  it('shows empty + loading when first opening a repo, then fills with results', async () => {
    listPRs.mockResolvedValue([PR(1), PR(2)])
    const promise = usePRStore.getState().loadPRs('/repo/a')
    expect(usePRStore.getState().loading).toBe(true)
    expect(usePRStore.getState().pullRequests).toEqual([])
    await promise
    expect(usePRStore.getState().loading).toBe(false)
    expect(usePRStore.getState().hasLoaded).toBe(true)
    expect(usePRStore.getState().pullRequests).toHaveLength(2)
  })

  it('shows the cached value immediately when re-opening a repo', async () => {
    usePRStore.setState({ prCache: { '/repo/a': [PR(7)] } })
    listPRs.mockResolvedValue([PR(7), PR(8)])
    const promise = usePRStore.getState().loadPRs('/repo/a')
    expect(usePRStore.getState().pullRequests).toEqual([PR(7)])
    expect(usePRStore.getState().loading).toBe(false)
    await promise
    expect(usePRStore.getState().pullRequests).toHaveLength(2)
  })

  it('discards stale fetches that finish after the user switched repos', async () => {
    let resolveA: (v: any) => void = () => {}
    listPRs.mockImplementationOnce(() => new Promise((r) => { resolveA = r }))
    const aPromise = usePRStore.getState().loadPRs('/repo/a')
    // Switch to repo b before a resolves
    listPRs.mockResolvedValueOnce([PR(99)])
    await usePRStore.getState().loadPRs('/repo/b')
    // Now resolve a
    resolveA([PR(1)])
    await aPromise
    // Visible state should still be repo b
    expect(usePRStore.getState().currentRepoPath).toBe('/repo/b')
    expect(usePRStore.getState().pullRequests).toEqual([PR(99)])
    // But the cache should now have entries for both
    expect(usePRStore.getState().prCache['/repo/a']).toEqual([PR(1)])
    expect(usePRStore.getState().prCache['/repo/b']).toEqual([PR(99)])
  })
})

describe('prStore.loadSeenPRs', () => {
  it('caches per-project and switches view on project change', async () => {
    getSeenPRs.mockResolvedValueOnce([1, 2])
    await usePRStore.getState().loadSeenPRs('p1')
    expect(usePRStore.getState().seenPRs).toEqual([1, 2])
    getSeenPRs.mockResolvedValueOnce([99])
    await usePRStore.getState().loadSeenPRs('p2')
    expect(usePRStore.getState().seenPRs).toEqual([99])
    expect(usePRStore.getState().seenCache).toEqual({ p1: [1, 2], p2: [99] })
  })
})

describe('prStore.loadCurrentUser', () => {
  it('sets the user once and skips subsequent calls', async () => {
    getCurrentUser.mockResolvedValue('alice')
    await usePRStore.getState().loadCurrentUser('/repo')
    await usePRStore.getState().loadCurrentUser('/repo')
    expect(getCurrentUser).toHaveBeenCalledTimes(1)
    expect(usePRStore.getState().currentUser).toBe('alice')
  })

  it('does not set user if api returns falsy', async () => {
    getCurrentUser.mockResolvedValue(null)
    await usePRStore.getState().loadCurrentUser('/repo')
    expect(usePRStore.getState().currentUser).toBeNull()
  })
})

describe('prStore.loadCollaborators', () => {
  it('returns cached value without re-fetching', async () => {
    usePRStore.setState({ collaboratorsCache: { '/repo': [{ login: 'x' } as any] } })
    const result = await usePRStore.getState().loadCollaborators('/repo')
    expect(result).toEqual([{ login: 'x' }])
    expect(listCollaborators).not.toHaveBeenCalled()
  })

  it('fetches and caches when not in cache', async () => {
    listCollaborators.mockResolvedValue([{ login: 'a' } as any])
    const result = await usePRStore.getState().loadCollaborators('/repo')
    expect(result).toEqual([{ login: 'a' }])
    expect(usePRStore.getState().collaboratorsCache['/repo']).toEqual([{ login: 'a' }])
  })
})

describe('prStore.markSeen', () => {
  it('appends a new pr number and persists via api', () => {
    usePRStore.setState({ seenPRs: [1] })
    usePRStore.getState().markSeen('p1', 2)
    expect(usePRStore.getState().seenPRs).toEqual([1, 2])
    expect(usePRStore.getState().seenCache.p1).toEqual([1, 2])
    expect(markPRSeen).toHaveBeenCalledWith('p1', 2)
  })

  it('is a no-op for already-seen prs', () => {
    usePRStore.setState({ seenPRs: [1, 2] })
    usePRStore.getState().markSeen('p1', 2)
    expect(usePRStore.getState().seenPRs).toEqual([1, 2])
    expect(markPRSeen).toHaveBeenCalled() // current behavior: still notifies api
  })
})

describe('prStore.clear', () => {
  it('clears the visible state but preserves caches', () => {
    usePRStore.setState({
      prCache: { '/repo/a': [PR(1)] },
      seenCache: { p1: [1] },
      collaboratorsCache: { '/repo/a': [{ login: 'x' } as any] },
      pullRequests: [PR(1)],
      seenPRs: [1],
      currentRepoPath: '/repo/a',
      currentProjectId: 'p1',
      hasLoaded: true,
    })
    usePRStore.getState().clear()
    const s = usePRStore.getState()
    expect(s.pullRequests).toEqual([])
    expect(s.seenPRs).toEqual([])
    expect(s.currentRepoPath).toBeNull()
    expect(s.currentProjectId).toBeNull()
    expect(s.hasLoaded).toBe(false)
    expect(s.prCache).toEqual({ '/repo/a': [PR(1)] })
    expect(s.seenCache).toEqual({ p1: [1] })
  })
})

describe('prStore.loadPRs (extended)', () => {
  it('does not flash loading when re-fetching the already-visible repo', async () => {
    listPRs.mockResolvedValueOnce([PR(1)])
    await usePRStore.getState().loadPRs('/repo/a')
    listPRs.mockResolvedValueOnce([PR(1), PR(2)])
    const second = usePRStore.getState().loadPRs('/repo/a')
    // Same repo: visible list and loading flag stay stable during the refetch
    expect(usePRStore.getState().loading).toBe(false)
    expect(usePRStore.getState().pullRequests).toEqual([PR(1)])
    await second
    expect(usePRStore.getState().pullRequests).toEqual([PR(1), PR(2)])
  })

  it('marks hasLoaded immediately when a cache entry exists', async () => {
    usePRStore.setState({ prCache: { '/repo/a': [] } })
    listPRs.mockResolvedValue([])
    const p = usePRStore.getState().loadPRs('/repo/a')
    expect(usePRStore.getState().hasLoaded).toBe(true)
    await p
  })
})

describe('prStore.loadSeenPRs (extended)', () => {
  it('shows the cached seen list instantly when revisiting a project', async () => {
    usePRStore.setState({ seenCache: { p1: [5] } })
    let resolve: (v: any) => void = () => {}
    getSeenPRs.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const p = usePRStore.getState().loadSeenPRs('p1')
    expect(usePRStore.getState().seenPRs).toEqual([5])
    resolve([5, 6])
    await p
    expect(usePRStore.getState().seenPRs).toEqual([5, 6])
  })

  it('discards stale seen results after switching projects, but keeps the cache', async () => {
    let resolveP1: (v: any) => void = () => {}
    getSeenPRs.mockImplementationOnce(() => new Promise((r) => { resolveP1 = r }))
    const p1Promise = usePRStore.getState().loadSeenPRs('p1')
    getSeenPRs.mockResolvedValueOnce([42])
    await usePRStore.getState().loadSeenPRs('p2')
    resolveP1([1])
    await p1Promise
    expect(usePRStore.getState().currentProjectId).toBe('p2')
    expect(usePRStore.getState().seenPRs).toEqual([42])
    expect(usePRStore.getState().seenCache.p1).toEqual([1])
  })
})

describe('prStore.loadCurrentUser (extended)', () => {
  it('passes the repo path through to the api', async () => {
    getCurrentUser.mockResolvedValue('bob')
    await usePRStore.getState().loadCurrentUser('/repo/z')
    expect(getCurrentUser).toHaveBeenCalledWith('/repo/z')
  })

  it('retries on a later call if the first fetch returned falsy', async () => {
    getCurrentUser.mockResolvedValueOnce(null).mockResolvedValueOnce('carol')
    await usePRStore.getState().loadCurrentUser('/repo')
    await usePRStore.getState().loadCurrentUser('/repo')
    expect(getCurrentUser).toHaveBeenCalledTimes(2)
    expect(usePRStore.getState().currentUser).toBe('carol')
  })
})

describe('prStore.markSeen (extended)', () => {
  it('starts a fresh list from empty state', () => {
    usePRStore.getState().markSeen('p1', 10)
    expect(usePRStore.getState().seenPRs).toEqual([10])
    expect(usePRStore.getState().seenCache.p1).toEqual([10])
  })

  it('only touches the cache entry of the given project', () => {
    usePRStore.setState({ seenCache: { p2: [99] }, seenPRs: [] })
    usePRStore.getState().markSeen('p1', 1)
    expect(usePRStore.getState().seenCache.p2).toEqual([99])
    expect(usePRStore.getState().seenCache.p1).toEqual([1])
  })
})

describe('prStore.clear (extended)', () => {
  it('keeps the collaborators cache and the current user', () => {
    usePRStore.setState({
      collaboratorsCache: { '/repo': [{ login: 'x' } as any] },
      currentUser: 'alice',
    })
    usePRStore.getState().clear()
    expect(usePRStore.getState().collaboratorsCache['/repo']).toEqual([{ login: 'x' }])
    expect(usePRStore.getState().currentUser).toBe('alice')
  })
})

const LOCAL = (over: Record<string, any> = {}) => ({
  id: 'lpr-1', localNumber: 1, projectId: 'p1', title: 'Local change',
  body: 'body', branch: 'feat/local', baseBranch: 'main', status: 'local',
  createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', log: [],
  ...over,
})

describe('prStore — local PRs', () => {
  it('adapts a local PR into a PullRequest with isLocal + negative number', async () => {
    listLocal.mockResolvedValue([LOCAL()])
    await usePRStore.getState().loadLocalPRs('p1')
    const prs = usePRStore.getState().pullRequests
    expect(prs).toHaveLength(1)
    expect(prs[0]).toMatchObject({
      isLocal: true, localPrId: 'lpr-1', number: -1,
      title: 'Local change', headRefName: 'feat/local', isDraft: true, state: 'OPEN',
    })
  })

  it('reflects merged state + CI status from the record', async () => {
    listLocal.mockResolvedValue([LOCAL({ status: 'merged', ciResult: { status: 'failure', checks: [], ranAt: 'x', runner: 'act' } })])
    await usePRStore.getState().loadLocalPRs('p1')
    const pr = usePRStore.getState().pullRequests[0]
    expect(pr.state).toBe('MERGED')
    expect(pr.ciStatus).toBe('failure')
  })

  it('merges local PRs ahead of remote PRs', async () => {
    listLocal.mockResolvedValue([LOCAL()])
    listPRs.mockResolvedValue([{ number: 1001 } as any])
    await usePRStore.getState().loadLocalPRs('p1')
    await usePRStore.getState().loadPRs('/repo')
    const prs = usePRStore.getState().pullRequests
    expect(prs).toHaveLength(2)
    expect(prs[0].isLocal).toBe(true)
    expect(prs[1].number).toBe(1001)
  })

  it('dedupes a promoted local PR against its real PR', async () => {
    listLocal.mockResolvedValue([LOCAL({ status: 'open', realPrNumber: 1001 })])
    listPRs.mockResolvedValue([{ number: 1001 } as any])
    await usePRStore.getState().loadLocalPRs('p1')
    await usePRStore.getState().loadPRs('/repo')
    const prs = usePRStore.getState().pullRequests
    expect(prs).toHaveLength(1)
    expect(prs[0].isLocal).toBeUndefined()
    expect(prs[0].number).toBe(1001)
  })

  it('applyLocalPRUpdate swaps the visible list only for the active project', () => {
    usePRStore.setState({ currentProjectId: 'p1' })
    usePRStore.getState().applyLocalPRUpdate('p1', [LOCAL({ title: 'Pushed' }) as any])
    expect(usePRStore.getState().pullRequests[0].title).toBe('Pushed')

    usePRStore.getState().applyLocalPRUpdate('p2', [LOCAL({ id: 'lpr-2', projectId: 'p2', title: 'Other' }) as any])
    expect(usePRStore.getState().pullRequests.some((p) => p.title === 'Other')).toBe(false)
    expect(usePRStore.getState().localPRCache['p2']).toHaveLength(1)
  })
})

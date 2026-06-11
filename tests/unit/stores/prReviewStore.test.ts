import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePRReviewStore } from '../../../src/renderer/stores/prReviewStore'

const apiMocks = {
  getDetail: vi.fn(),
  getFiles: vi.fn(),
  getDiff: vi.fn(),
  getComments: vi.fn(),
  getMergeability: vi.fn(),
  getConversationComments: vi.fn(),
  getChecks: vi.fn(),
  getViewedFiles: vi.fn(),
  setViewedFiles: vi.fn(),
  getCommits: vi.fn(),
  getCommitDiff: vi.fn(),
  getReviewThreads: vi.fn(),
  getFilePatch: vi.fn(),
  createComment: vi.fn(),
  submitReview: vi.fn(),
  merge: vi.fn(),
  listCollaborators: vi.fn(),
  requestReviewer: vi.fn(),
  removeReviewer: vi.fn(),
  replyToThread: vi.fn(),
  resolveThread: vi.fn(),
  unresolveThread: vi.fn(),
  applySuggestion: vi.fn(),
  getFileBlob: vi.fn(),
}

beforeEach(() => {
  for (const fn of Object.values(apiMocks)) (fn as any).mockReset()
  ;(window as any).api = { github: apiMocks }
  // Reset to a known empty state
  usePRReviewStore.getState().clear()
})

const F = (path: string) => ({ path, status: 'modified', additions: 1, deletions: 0 } as any)

describe('prReviewStore.clear', () => {
  it('returns to a fresh empty state', () => {
    usePRReviewStore.setState({
      prNumber: 42,
      files: [F('a.ts')],
      selectedFilePath: 'a.ts',
      fullDiff: 'old',
      mergeable: 'MERGEABLE',
      loading: true,
      activeTab: 'files',
    } as any)
    usePRReviewStore.getState().clear()
    const s = usePRReviewStore.getState()
    expect(s.prNumber).toBeNull()
    expect(s.files).toEqual([])
    expect(s.selectedFilePath).toBeNull()
    expect(s.fullDiff).toBeNull()
    expect(s.mergeable).toBe('UNKNOWN')
    expect(s.loading).toBe(false)
    expect(s.activeTab).toBe('conversation')
  })
})

describe('prReviewStore navigation', () => {
  beforeEach(() => {
    usePRReviewStore.setState({
      files: [F('a.ts'), F('b.ts'), F('c.ts')],
      selectedFilePath: 'b.ts',
    } as any)
  })

  it('selectFile updates selection', () => {
    usePRReviewStore.getState().selectFile('a.ts')
    expect(usePRReviewStore.getState().selectedFilePath).toBe('a.ts')
  })

  it('selectNextFile advances and clamps at end', () => {
    usePRReviewStore.getState().selectNextFile()
    expect(usePRReviewStore.getState().selectedFilePath).toBe('c.ts')
    usePRReviewStore.getState().selectNextFile()
    expect(usePRReviewStore.getState().selectedFilePath).toBe('c.ts')
  })

  it('selectPrevFile retreats and clamps at start', () => {
    usePRReviewStore.getState().selectPrevFile()
    expect(usePRReviewStore.getState().selectedFilePath).toBe('a.ts')
    usePRReviewStore.getState().selectPrevFile()
    expect(usePRReviewStore.getState().selectedFilePath).toBe('a.ts')
  })
})

describe('prReviewStore.setViewMode / setActiveTab / setCommentFilter', () => {
  it('toggles viewMode', () => {
    usePRReviewStore.getState().setViewMode('scroll')
    expect(usePRReviewStore.getState().viewMode).toBe('scroll')
    usePRReviewStore.getState().setViewMode('single')
    expect(usePRReviewStore.getState().viewMode).toBe('single')
  })

  it('switches activeTab', () => {
    usePRReviewStore.getState().setActiveTab('files')
    expect(usePRReviewStore.getState().activeTab).toBe('files')
    usePRReviewStore.getState().setActiveTab('commits')
    expect(usePRReviewStore.getState().activeTab).toBe('commits')
  })

  it('setCommentFilter persists the value', () => {
    usePRReviewStore.getState().setCommentFilter('unresolved')
    expect(usePRReviewStore.getState().commentFilter).toBe('unresolved')
  })
})

describe('prReviewStore.toggleFileViewed', () => {
  it('adds and removes a path from the viewed set, persists via api', () => {
    apiMocks.setViewedFiles.mockResolvedValue(undefined)
    usePRReviewStore.setState({ viewedFiles: new Set(), prNumber: 10 } as any)
    usePRReviewStore.getState().toggleFileViewed('p1', 10, 'a.ts')
    expect(usePRReviewStore.getState().viewedFiles.has('a.ts')).toBe(true)
    expect(apiMocks.setViewedFiles).toHaveBeenCalledWith('p1', 10, ['a.ts'])
    usePRReviewStore.getState().toggleFileViewed('p1', 10, 'a.ts')
    expect(usePRReviewStore.getState().viewedFiles.has('a.ts')).toBe(false)
  })
})

describe('prReviewStore.resetExpandedLines', () => {
  it('clears the per-file/side set', () => {
    const expanded = new Set([1, 2, 3])
    usePRReviewStore.setState({
      expandedLines: { 'head:a.ts': expanded, 'base:b.ts': new Set([5]) },
    } as any)
    usePRReviewStore.getState().resetExpandedLines('a.ts', 'head')
    expect(usePRReviewStore.getState().expandedLines['head:a.ts']?.size ?? 0).toBe(0)
    // unrelated keys untouched
    expect(usePRReviewStore.getState().expandedLines['base:b.ts'].has(5)).toBe(true)
  })
})

describe('prReviewStore.stopPollingChecks', () => {
  it('flips the polling flag off without throwing when not polling', () => {
    usePRReviewStore.setState({ checksPolling: true } as any)
    usePRReviewStore.getState().stopPollingChecks()
    expect(usePRReviewStore.getState().checksPolling).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Extended coverage (appended). Imports below are hoisted by ESM semantics.
// ───────────────────────────────────────────────────────────────────────────
import { useToastStore } from '../../../src/renderer/stores/toastStore'

// The source store calls a few api methods the original mock map does not
// declare (replyThread, addReviewer). They are added per-describe below.
const replyThread = vi.fn()
const addReviewer = vi.fn()

const CHECK = (status: string, conclusion: string | null = null) => ({
  name: 'ci', status, conclusion, startedAt: null, completedAt: null, detailsUrl: null,
}) as any

const DETAIL = (overrides: Record<string, unknown> = {}) => ({
  body: 'desc', author: 'alice', title: 'My PR', createdAt: 'now',
  baseRefName: 'main', headRefName: 'feat', baseRefOid: 'base-sha', headRefOid: 'head-sha',
  requestedReviewers: [], reviews: [],
  ...overrides,
}) as any

function primeLoadPR(overrides: Partial<Record<string, unknown>> = {}) {
  apiMocks.getFiles.mockResolvedValue((overrides.files as any) ?? [F('a.ts'), F('b.ts')])
  apiMocks.getDiff.mockResolvedValue((overrides.fullDiff as any) ?? '@@diff@@')
  apiMocks.getComments.mockResolvedValue((overrides.comments as any) ?? [{ id: 1, body: 'c' }])
  apiMocks.getMergeability.mockResolvedValue((overrides.mergeability as any) ?? { mergeable: 'MERGEABLE' })
  apiMocks.getDetail.mockResolvedValue((overrides.detail as any) ?? DETAIL())
  apiMocks.getConversationComments.mockResolvedValue((overrides.conversation as any) ?? [{ id: 9, body: 'hello' }])
  apiMocks.getChecks.mockResolvedValue((overrides.checks as any) ?? [CHECK('completed', 'success')])
  apiMocks.getViewedFiles.mockResolvedValue((overrides.viewed as any) ?? ['a.ts'])
  apiMocks.getCommits.mockResolvedValue((overrides.commits as any) ?? [{ hash: 'h1', message: 'm', author: 'a', date: 'd' }])
  apiMocks.getReviewThreads.mockResolvedValue((overrides.threads as any) ?? [])
}

describe('prReviewStore.loadPR', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('loads every facet of the PR and selects the first file', async () => {
    primeLoadPR()
    await usePRReviewStore.getState().loadPR('/repo', 5, 'proj1')
    const s = usePRReviewStore.getState()
    expect(s.prNumber).toBe(5)
    expect(s.files.map((f: any) => f.path)).toEqual(['a.ts', 'b.ts'])
    expect(s.fullDiff).toBe('@@diff@@')
    expect(s.comments).toHaveLength(1)
    expect(s.mergeable).toBe('MERGEABLE')
    expect(s.detail.title).toBe('My PR')
    expect(s.conversationComments).toHaveLength(1)
    expect(s.checks).toHaveLength(1)
    expect(s.viewedFiles.has('a.ts')).toBe(true)
    expect(s.commits).toHaveLength(1)
    expect(s.selectedFilePath).toBe('a.ts')
    expect(s.loading).toBe(false)
    expect(s.checksPolling).toBe(false)
  })

  it('skips the fetch entirely when the same PR is already loaded', async () => {
    usePRReviewStore.setState({ prNumber: 5, files: [F('a.ts')] } as any)
    await usePRReviewStore.getState().loadPR('/repo', 5)
    expect(apiMocks.getFiles).not.toHaveBeenCalled()
  })

  it('clears stale data synchronously before a non-forced load', async () => {
    usePRReviewStore.setState({
      prNumber: 4, files: [F('stale.ts')], fullDiff: 'old', selectedFilePath: 'stale.ts',
    } as any)
    primeLoadPR()
    const p = usePRReviewStore.getState().loadPR('/repo', 5)
    expect(usePRReviewStore.getState().files).toEqual([])
    expect(usePRReviewStore.getState().fullDiff).toBeNull()
    expect(usePRReviewStore.getState().loading).toBe(true)
    await p
  })

  it('force reload keeps existing data visible while refetching', async () => {
    usePRReviewStore.setState({ prNumber: 5, files: [F('a.ts')], fullDiff: 'old' } as any)
    primeLoadPR()
    const p = usePRReviewStore.getState().loadPR('/repo', 5, undefined, true)
    expect(usePRReviewStore.getState().files.map((f: any) => f.path)).toEqual(['a.ts'])
    expect(usePRReviewStore.getState().fullDiff).toBe('old')
    expect(usePRReviewStore.getState().loading).toBe(true)
    await p
    expect(usePRReviewStore.getState().fullDiff).toBe('@@diff@@')
  })

  it('force reload preserves the selected file when it still exists', async () => {
    usePRReviewStore.setState({ prNumber: 5, files: [F('a.ts'), F('b.ts')], selectedFilePath: 'b.ts' } as any)
    primeLoadPR()
    await usePRReviewStore.getState().loadPR('/repo', 5, undefined, true)
    expect(usePRReviewStore.getState().selectedFilePath).toBe('b.ts')
  })

  it('falls back to the first file when the previous selection vanished', async () => {
    usePRReviewStore.setState({ prNumber: 5, files: [F('gone.ts')], selectedFilePath: 'gone.ts' } as any)
    primeLoadPR()
    await usePRReviewStore.getState().loadPR('/repo', 5, undefined, true)
    expect(usePRReviewStore.getState().selectedFilePath).toBe('a.ts')
  })

  it('force reload preserves the selected commit and its diff', async () => {
    usePRReviewStore.setState({
      prNumber: 5, files: [F('a.ts')], selectedCommitHash: 'h1', commitDiff: '@@h1@@',
    } as any)
    primeLoadPR()
    await usePRReviewStore.getState().loadPR('/repo', 5, undefined, true)
    expect(usePRReviewStore.getState().selectedCommitHash).toBe('h1')
    expect(usePRReviewStore.getState().commitDiff).toBe('@@h1@@')
  })

  it('skips the viewed-files fetch when no projectId is given', async () => {
    primeLoadPR()
    await usePRReviewStore.getState().loadPR('/repo', 5)
    expect(apiMocks.getViewedFiles).not.toHaveBeenCalled()
    expect(usePRReviewStore.getState().viewedFiles.size).toBe(0)
  })

  it('starts polling when any check is still running', async () => {
    vi.useFakeTimers()
    primeLoadPR({ checks: [CHECK('in_progress')] })
    await usePRReviewStore.getState().loadPR('/repo', 5)
    expect(usePRReviewStore.getState().checksPolling).toBe(true)
    usePRReviewStore.getState().stopPollingChecks()
  })

  it('toasts and clears loading when the fetch fails', async () => {
    primeLoadPR()
    apiMocks.getFiles.mockRejectedValue(new Error('rate limited'))
    await usePRReviewStore.getState().loadPR('/repo', 5)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'rate limited' })
    expect(usePRReviewStore.getState().loading).toBe(false)
  })
})

describe('prReviewStore.loadFileDiff', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('fetches the patch once and caches it per path', async () => {
    apiMocks.getFilePatch.mockResolvedValue('@@patch-a@@')
    await usePRReviewStore.getState().loadFileDiff('/repo', 5, 'a.ts')
    expect(usePRReviewStore.getState().fileDiffCache['a.ts']).toBe('@@patch-a@@')
    await usePRReviewStore.getState().loadFileDiff('/repo', 5, 'a.ts')
    expect(apiMocks.getFilePatch).toHaveBeenCalledTimes(1)
  })

  it('tracks the in-flight path in fileDiffLoading and clears it afterwards', async () => {
    let resolve: (v: string) => void = () => {}
    apiMocks.getFilePatch.mockImplementation(() => new Promise((r) => { resolve = r }))
    const p = usePRReviewStore.getState().loadFileDiff('/repo', 5, 'a.ts')
    expect(usePRReviewStore.getState().fileDiffLoading).toBe('a.ts')
    resolve('@@patch@@')
    await p
    expect(usePRReviewStore.getState().fileDiffLoading).toBeNull()
  })

  it('toasts on fetch failure and resets the loading marker', async () => {
    apiMocks.getFilePatch.mockRejectedValue(new Error('gone'))
    await usePRReviewStore.getState().loadFileDiff('/repo', 5, 'a.ts')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'gone' })
    expect(usePRReviewStore.getState().fileDiffLoading).toBeNull()
    expect(usePRReviewStore.getState().fileDiffCache['a.ts']).toBeUndefined()
  })
})

describe('prReviewStore.addComment', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('passes only the end line for single-line comments', async () => {
    apiMocks.createComment.mockResolvedValue({ id: 7, body: 'hi' })
    await usePRReviewStore.getState().addComment('/repo', 5, 'hi', 'a.ts', 12, 12, 'RIGHT')
    expect(apiMocks.createComment).toHaveBeenCalledWith('/repo', 5, 'hi', 'a.ts', 12, undefined, 'RIGHT')
    expect(usePRReviewStore.getState().comments).toEqual([{ id: 7, body: 'hi' }])
  })

  it('passes the start line for multi-line comments', async () => {
    apiMocks.createComment.mockResolvedValue({ id: 8, body: 'range' })
    await usePRReviewStore.getState().addComment('/repo', 5, 'range', 'a.ts', 3, 9, 'LEFT')
    expect(apiMocks.createComment).toHaveBeenCalledWith('/repo', 5, 'range', 'a.ts', 9, 3, 'LEFT')
  })

  it('toasts and keeps the comment list unchanged on failure', async () => {
    apiMocks.createComment.mockRejectedValue(new Error('forbidden'))
    await usePRReviewStore.getState().addComment('/repo', 5, 'x', 'a.ts', 1, 1, 'RIGHT')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'forbidden' })
    expect(usePRReviewStore.getState().comments).toEqual([])
  })
})

describe('prReviewStore.submitReview / merge', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('APPROVE shows an Approved success toast and resets reviewLoading', async () => {
    apiMocks.submitReview.mockResolvedValue(undefined)
    await usePRReviewStore.getState().submitReview('/repo', 5, 'APPROVE', 'lgtm')
    expect(apiMocks.submitReview).toHaveBeenCalledWith('/repo', 5, 'APPROVE', 'lgtm')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'success', message: 'Approved on PR #5' })
    expect(usePRReviewStore.getState().reviewLoading).toBe(false)
  })

  it('REQUEST_CHANGES uses the changes-requested wording', async () => {
    apiMocks.submitReview.mockResolvedValue(undefined)
    await usePRReviewStore.getState().submitReview('/repo', 5, 'REQUEST_CHANGES')
    expect(useToastStore.getState().toasts[0].message).toBe('Changes requested on PR #5')
  })

  it('COMMENT uses the comment-submitted wording', async () => {
    apiMocks.submitReview.mockResolvedValue(undefined)
    await usePRReviewStore.getState().submitReview('/repo', 5, 'COMMENT')
    expect(useToastStore.getState().toasts[0].message).toBe('Comment submitted on PR #5')
  })

  it('toasts the error and resets reviewLoading when submission fails', async () => {
    apiMocks.submitReview.mockRejectedValue(new Error('rejected'))
    await usePRReviewStore.getState().submitReview('/repo', 5, 'APPROVE')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'rejected' })
    expect(usePRReviewStore.getState().reviewLoading).toBe(false)
  })

  it('merge success toasts and resets mergeLoading', async () => {
    apiMocks.merge.mockResolvedValue(undefined)
    await usePRReviewStore.getState().merge('/repo', 5, 'squash')
    expect(apiMocks.merge).toHaveBeenCalledWith('/repo', 5, 'squash')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'success', message: 'PR #5 merged' })
    expect(usePRReviewStore.getState().mergeLoading).toBe(false)
  })

  it('merge failure toasts the error and resets mergeLoading', async () => {
    apiMocks.merge.mockRejectedValue(new Error('conflict'))
    await usePRReviewStore.getState().merge('/repo', 5, 'merge')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'conflict' })
    expect(usePRReviewStore.getState().mergeLoading).toBe(false)
  })
})

describe('prReviewStore commit navigation', () => {
  const COMMITS = [
    { hash: 'h1', message: '1', author: 'a', date: 'd' },
    { hash: 'h2', message: '2', author: 'a', date: 'd' },
  ] as any

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    usePRReviewStore.setState({ commits: COMMITS, files: [F('a.ts')] } as any)
    apiMocks.getCommitDiff.mockResolvedValue('@@commit@@')
  })

  it('selectCommit fetches and stores the commit diff', async () => {
    await usePRReviewStore.getState().selectCommit('/repo', 'h1')
    expect(apiMocks.getCommitDiff).toHaveBeenCalledWith('/repo', 'h1')
    expect(usePRReviewStore.getState().selectedCommitHash).toBe('h1')
    expect(usePRReviewStore.getState().commitDiff).toBe('@@commit@@')
    expect(usePRReviewStore.getState().selectedFilePath).toBeNull()
  })

  it('selectCommit(null) clears the commit view and re-selects the first file', async () => {
    usePRReviewStore.setState({ selectedCommitHash: 'h1', commitDiff: 'x' } as any)
    await usePRReviewStore.getState().selectCommit('/repo', null)
    const s = usePRReviewStore.getState()
    expect(s.selectedCommitHash).toBeNull()
    expect(s.commitDiff).toBeNull()
    expect(s.selectedFilePath).toBe('a.ts')
  })

  it('selectCommit toasts and nulls the diff when the fetch fails', async () => {
    apiMocks.getCommitDiff.mockRejectedValue(new Error('lost'))
    await usePRReviewStore.getState().selectCommit('/repo', 'h1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'lost' })
    expect(usePRReviewStore.getState().commitDiff).toBeNull()
  })

  it('nextCommit starts at the first commit when none is selected', async () => {
    await usePRReviewStore.getState().nextCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBe('h1')
  })

  it('nextCommit stops at the last commit', async () => {
    usePRReviewStore.setState({ selectedCommitHash: 'h2' } as any)
    await usePRReviewStore.getState().nextCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBe('h2')
    expect(apiMocks.getCommitDiff).not.toHaveBeenCalled()
  })

  it('nextCommit is a no-op when there are no commits', async () => {
    usePRReviewStore.setState({ commits: [] } as any)
    await usePRReviewStore.getState().nextCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBeNull()
  })

  it('prevCommit walks back one commit', async () => {
    usePRReviewStore.setState({ selectedCommitHash: 'h2' } as any)
    await usePRReviewStore.getState().prevCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBe('h1')
  })

  it('prevCommit from the first commit clears the selection', async () => {
    usePRReviewStore.setState({ selectedCommitHash: 'h1' } as any)
    await usePRReviewStore.getState().prevCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBeNull()
  })

  it('prevCommit is a no-op when nothing is selected', async () => {
    await usePRReviewStore.getState().prevCommit('/repo')
    expect(usePRReviewStore.getState().selectedCommitHash).toBeNull()
    expect(apiMocks.getCommitDiff).not.toHaveBeenCalled()
  })
})

describe('prReviewStore.pollChecks', () => {
  it('refreshes checks on each tick and stops when everything completed', async () => {
    vi.useFakeTimers()
    usePRReviewStore.setState({ prNumber: 5 } as any)
    apiMocks.getChecks.mockResolvedValueOnce([CHECK('in_progress')])
    usePRReviewStore.getState().pollChecks('/repo', 5)
    expect(usePRReviewStore.getState().checksPolling).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(usePRReviewStore.getState().checks).toEqual([CHECK('in_progress')])
    expect(usePRReviewStore.getState().checksPolling).toBe(true)

    apiMocks.getChecks.mockResolvedValueOnce([CHECK('completed', 'success')])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(usePRReviewStore.getState().checks).toEqual([CHECK('completed', 'success')])
    expect(usePRReviewStore.getState().checksPolling).toBe(false)
  })

  it('stops itself when the user switched to a different PR', async () => {
    vi.useFakeTimers()
    usePRReviewStore.setState({ prNumber: 5 } as any)
    apiMocks.getChecks.mockResolvedValue([CHECK('in_progress')])
    usePRReviewStore.getState().pollChecks('/repo', 5)
    usePRReviewStore.setState({ prNumber: 6 } as any)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(usePRReviewStore.getState().checksPolling).toBe(false)
    expect(usePRReviewStore.getState().checks).toEqual([])
  })

  it('silently keeps polling across fetch errors', async () => {
    vi.useFakeTimers()
    usePRReviewStore.setState({ prNumber: 5 } as any)
    apiMocks.getChecks.mockRejectedValue(new Error('offline'))
    usePRReviewStore.getState().pollChecks('/repo', 5)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(usePRReviewStore.getState().checksPolling).toBe(true)
    usePRReviewStore.getState().stopPollingChecks()
  })

  it('restarting polling replaces the previous interval', async () => {
    vi.useFakeTimers()
    usePRReviewStore.setState({ prNumber: 5 } as any)
    apiMocks.getChecks.mockResolvedValue([CHECK('in_progress')])
    usePRReviewStore.getState().pollChecks('/repo', 5)
    usePRReviewStore.getState().pollChecks('/repo', 5)
    await vi.advanceTimersByTimeAsync(10_000)
    // One interval only: one fetch per tick
    expect(apiMocks.getChecks).toHaveBeenCalledTimes(1)
    usePRReviewStore.getState().stopPollingChecks()
  })
})

describe('prReviewStore reviewers', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    addReviewer.mockReset()
    ;(window as any).api.github.addReviewer = addReviewer
    // Note: clear() intentionally does NOT reset collaborators (they are a
    // per-repo cache), so reset them here for isolation.
    usePRReviewStore.setState({ collaborators: [], reviewerLoading: false } as any)
  })

  it('loadCollaborators fetches and stores the list', async () => {
    apiMocks.listCollaborators.mockResolvedValue([{ login: 'bob' }])
    await usePRReviewStore.getState().loadCollaborators('/repo')
    expect(usePRReviewStore.getState().collaborators).toEqual([{ login: 'bob' }])
  })

  it('loadCollaborators skips the fetch when already populated', async () => {
    usePRReviewStore.setState({ collaborators: [{ login: 'kept' }] } as any)
    await usePRReviewStore.getState().loadCollaborators('/repo')
    expect(apiMocks.listCollaborators).not.toHaveBeenCalled()
    expect(usePRReviewStore.getState().collaborators).toEqual([{ login: 'kept' }])
  })

  it('loadCollaborators swallows errors without toasting', async () => {
    apiMocks.listCollaborators.mockRejectedValue(new Error('nope'))
    await usePRReviewStore.getState().loadCollaborators('/repo')
    expect(useToastStore.getState().toasts).toEqual([])
    expect(usePRReviewStore.getState().collaborators).toEqual([])
  })

  it('addReviewer requests the review, refreshes detail and toasts success', async () => {
    addReviewer.mockResolvedValue(undefined)
    apiMocks.getDetail.mockResolvedValue(DETAIL({ requestedReviewers: ['carol'] }))
    await usePRReviewStore.getState().addReviewer('/repo', 5, 'carol')
    expect(addReviewer).toHaveBeenCalledWith('/repo', 5, 'carol')
    expect(usePRReviewStore.getState().detail.requestedReviewers).toEqual(['carol'])
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: 'Requested review from carol',
    })
    expect(usePRReviewStore.getState().reviewerLoading).toBe(false)
  })

  it('addReviewer toasts the error and resets reviewerLoading on failure', async () => {
    addReviewer.mockRejectedValue(new Error('not a collaborator'))
    await usePRReviewStore.getState().addReviewer('/repo', 5, 'evil')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'not a collaborator' })
    expect(usePRReviewStore.getState().reviewerLoading).toBe(false)
  })

  it('removeReviewer refreshes detail without a success toast', async () => {
    apiMocks.removeReviewer.mockResolvedValue(undefined)
    apiMocks.getDetail.mockResolvedValue(DETAIL({ requestedReviewers: [] }))
    await usePRReviewStore.getState().removeReviewer('/repo', 5, 'carol')
    expect(apiMocks.removeReviewer).toHaveBeenCalledWith('/repo', 5, 'carol')
    expect(usePRReviewStore.getState().detail.requestedReviewers).toEqual([])
    expect(useToastStore.getState().toasts).toEqual([])
  })

  it('removeReviewer toasts on failure', async () => {
    apiMocks.removeReviewer.mockRejectedValue(new Error('cannot'))
    await usePRReviewStore.getState().removeReviewer('/repo', 5, 'carol')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'cannot' })
  })
})

describe('prReviewStore threads', () => {
  const THREAD = (id: string, rootCommentId: number, isResolved = false) => ({
    id, path: 'a.ts', line: 1, isResolved, rootCommentId, comments: [{ id: rootCommentId, body: 'root' }],
  }) as any

  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    replyThread.mockReset()
    ;(window as any).api.github.replyThread = replyThread
    usePRReviewStore.setState({
      comments: [{ id: 1, body: 'root' }] as any,
      reviewThreads: [THREAD('t1', 1), THREAD('t2', 2)],
    } as any)
  })

  it('replyToThread appends the reply to comments and only the matching thread', async () => {
    const reply = { id: 99, body: 'reply!' }
    replyThread.mockResolvedValue(reply)
    await usePRReviewStore.getState().replyToThread('/repo', 5, 1, 'reply!')
    expect(replyThread).toHaveBeenCalledWith('/repo', 5, 1, 'reply!')
    const s = usePRReviewStore.getState()
    expect(s.comments.map((c: any) => c.id)).toEqual([1, 99])
    expect(s.reviewThreads[0].comments.map((c: any) => c.id)).toEqual([1, 99])
    expect(s.reviewThreads[1].comments.map((c: any) => c.id)).toEqual([2])
  })

  it('replyToThread toasts on failure and changes nothing', async () => {
    replyThread.mockRejectedValue(new Error('locked thread'))
    await usePRReviewStore.getState().replyToThread('/repo', 5, 1, 'x')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'locked thread' })
    expect(usePRReviewStore.getState().comments).toHaveLength(1)
  })

  it('resolveThread marks only the matching thread resolved', async () => {
    apiMocks.resolveThread.mockResolvedValue(undefined)
    await usePRReviewStore.getState().resolveThread('/repo', 5, 't1')
    expect(apiMocks.resolveThread).toHaveBeenCalledWith('/repo', 't1')
    const s = usePRReviewStore.getState()
    expect(s.reviewThreads.find((t: any) => t.id === 't1')!.isResolved).toBe(true)
    expect(s.reviewThreads.find((t: any) => t.id === 't2')!.isResolved).toBe(false)
  })

  it('resolveThread failure toasts and leaves the thread unresolved', async () => {
    apiMocks.resolveThread.mockRejectedValue(new Error('api down'))
    await usePRReviewStore.getState().resolveThread('/repo', 5, 't1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'api down' })
    expect(usePRReviewStore.getState().reviewThreads[0].isResolved).toBe(false)
  })

  it('unresolveThread flips the resolved flag back off', async () => {
    usePRReviewStore.setState({ reviewThreads: [THREAD('t1', 1, true)] } as any)
    apiMocks.unresolveThread.mockResolvedValue(undefined)
    await usePRReviewStore.getState().unresolveThread('/repo', 5, 't1')
    expect(apiMocks.unresolveThread).toHaveBeenCalledWith('/repo', 't1')
    expect(usePRReviewStore.getState().reviewThreads[0].isResolved).toBe(false)
  })

  it('unresolveThread failure toasts and keeps the thread resolved', async () => {
    usePRReviewStore.setState({ reviewThreads: [THREAD('t1', 1, true)] } as any)
    apiMocks.unresolveThread.mockRejectedValue(new Error('cannot'))
    await usePRReviewStore.getState().unresolveThread('/repo', 5, 't1')
    expect(usePRReviewStore.getState().reviewThreads[0].isResolved).toBe(true)
  })
})

describe('prReviewStore.expandContext', () => {
  beforeEach(() => {
    usePRReviewStore.setState({ detail: DETAIL() } as any)
  })

  it('does nothing without PR detail', async () => {
    usePRReviewStore.setState({ detail: null } as any)
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 1, 3)
    expect(apiMocks.getFileBlob).not.toHaveBeenCalled()
  })

  it('does nothing when the side ref oid is missing', async () => {
    usePRReviewStore.setState({ detail: DETAIL({ baseRefOid: undefined }) } as any)
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'base', 1, 3)
    expect(apiMocks.getFileBlob).not.toHaveBeenCalled()
  })

  it('fetches the head blob, strips the trailing newline entry and records the range', async () => {
    apiMocks.getFileBlob.mockResolvedValue('l1\nl2\nl3\n')
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 2, 3)
    expect(apiMocks.getFileBlob).toHaveBeenCalledWith('/repo', 'head-sha', 'a.ts')
    const s = usePRReviewStore.getState()
    expect(s.blobCache['head:a.ts'].lines).toEqual(['l1', 'l2', 'l3'])
    expect([...s.expandedLines['head:a.ts']].sort()).toEqual([2, 3])
  })

  it('uses the base ref oid for the base side', async () => {
    apiMocks.getFileBlob.mockResolvedValue('x\n')
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'base', 1, 1)
    expect(apiMocks.getFileBlob).toHaveBeenCalledWith('/repo', 'base-sha', 'a.ts')
    expect(usePRReviewStore.getState().expandedLines['base:a.ts'].has(1)).toBe(true)
  })

  it('reuses the cached blob for subsequent expansions', async () => {
    apiMocks.getFileBlob.mockResolvedValue('l1\nl2\nl3\nl4\n')
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 1, 2)
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 3, 4)
    expect(apiMocks.getFileBlob).toHaveBeenCalledTimes(1)
    expect([...usePRReviewStore.getState().expandedLines['head:a.ts']].sort()).toEqual([1, 2, 3, 4])
  })

  it('normalises inverted ranges and clamps below 1', async () => {
    apiMocks.getFileBlob.mockResolvedValue('a\nb\nc\n')
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 2, -1)
    const expanded = [...usePRReviewStore.getState().expandedLines['head:a.ts']].sort()
    expect(expanded).toEqual([1, 2])
  })

  it('drops the cache placeholder when the blob is missing so a retry refetches', async () => {
    apiMocks.getFileBlob.mockResolvedValueOnce(null)
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 1, 2)
    expect(usePRReviewStore.getState().blobCache['head:a.ts']).toBeUndefined()
    expect(usePRReviewStore.getState().expandedLines['head:a.ts']).toBeUndefined()

    apiMocks.getFileBlob.mockResolvedValueOnce('ok\n')
    await usePRReviewStore.getState().expandContext('/repo', 'a.ts', 'head', 1, 1)
    expect(apiMocks.getFileBlob).toHaveBeenCalledTimes(2)
    expect(usePRReviewStore.getState().expandedLines['head:a.ts'].has(1)).toBe(true)
  })
})

describe('prReviewStore.applySuggestion', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('toasts success and returns the result when applied', async () => {
    apiMocks.applySuggestion.mockResolvedValue({ applied: true })
    const out = await usePRReviewStore.getState().applySuggestion('/repo', 'a.ts', 1, 2, 'new', 'bob')
    expect(apiMocks.applySuggestion).toHaveBeenCalledWith('/repo', 'a.ts', 1, 2, 'new', 'bob')
    expect(out).toEqual({ applied: true })
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: 'Applied suggestion to a.ts',
    })
  })

  it('toasts the reason when the suggestion could not be applied', async () => {
    apiMocks.applySuggestion.mockResolvedValue({ applied: false, reason: 'file changed' })
    const out = await usePRReviewStore.getState().applySuggestion('/repo', 'a.ts', 1, 2, 'new', 'bob')
    expect(out.applied).toBe(false)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'file changed' })
  })

  it('uses a fallback message when no reason is provided', async () => {
    apiMocks.applySuggestion.mockResolvedValue({ applied: false })
    await usePRReviewStore.getState().applySuggestion('/repo', 'a.ts', 1, 2, 'new', 'bob')
    expect(useToastStore.getState().toasts[0].message).toBe('Could not apply suggestion')
  })

  it('converts thrown errors into a failed result', async () => {
    apiMocks.applySuggestion.mockRejectedValue(new Error('io error'))
    const out = await usePRReviewStore.getState().applySuggestion('/repo', 'a.ts', 1, 2, 'new', 'bob')
    expect(out).toEqual({ applied: false, reason: 'io error' })
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'io error' })
  })
})

describe('prReviewStore.toggleFileViewed (multi-file)', () => {
  it('keeps other viewed paths when toggling one off', () => {
    apiMocks.setViewedFiles.mockResolvedValue(undefined)
    usePRReviewStore.setState({ viewedFiles: new Set(['a.ts', 'b.ts']) } as any)
    usePRReviewStore.getState().toggleFileViewed('p1', 10, 'a.ts')
    expect(usePRReviewStore.getState().viewedFiles.has('b.ts')).toBe(true)
    expect(usePRReviewStore.getState().viewedFiles.has('a.ts')).toBe(false)
    expect(apiMocks.setViewedFiles).toHaveBeenCalledWith('p1', 10, ['b.ts'])
  })
})

describe('prReviewStore.clear (polling interaction)', () => {
  it('stops an active checks poll', () => {
    vi.useFakeTimers()
    apiMocks.getChecks.mockResolvedValue([CHECK('in_progress')])
    usePRReviewStore.setState({ prNumber: 5 } as any)
    usePRReviewStore.getState().pollChecks('/repo', 5)
    expect(usePRReviewStore.getState().checksPolling).toBe(true)
    usePRReviewStore.getState().clear()
    expect(usePRReviewStore.getState().checksPolling).toBe(false)
    expect(usePRReviewStore.getState().prNumber).toBeNull()
  })

  it('resets viewed files, threads, caches and filters', () => {
    usePRReviewStore.setState({
      viewedFiles: new Set(['a.ts']),
      reviewThreads: [{ id: 't1' }] as any,
      blobCache: { 'head:a.ts': { lines: ['x'] } } as any,
      expandedLines: { 'head:a.ts': new Set([1]) } as any,
      commentFilter: 'unresolved',
      fileDiffCache: { 'a.ts': 'patch' },
    } as any)
    usePRReviewStore.getState().clear()
    const s = usePRReviewStore.getState()
    expect(s.viewedFiles.size).toBe(0)
    expect(s.reviewThreads).toEqual([])
    expect(s.blobCache).toEqual({})
    expect(s.expandedLines).toEqual({})
    expect(s.commentFilter).toBe('all')
    expect(s.fileDiffCache).toEqual({})
  })

  it('keeps the collaborators cache across clear (current behavior)', () => {
    usePRReviewStore.setState({ collaborators: [{ login: 'cached' }] } as any)
    usePRReviewStore.getState().clear()
    expect(usePRReviewStore.getState().collaborators).toEqual([{ login: 'cached' }])
    usePRReviewStore.setState({ collaborators: [] } as any)
  })
})

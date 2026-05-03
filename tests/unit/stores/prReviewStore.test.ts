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

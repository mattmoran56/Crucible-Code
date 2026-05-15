import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRConversationTab } from '../../../../src/renderer/components/pullrequests/PRConversationTab'
import { usePRReviewStore } from '../../../../src/renderer/stores/prReviewStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import type {
  PRComment,
  PRDetail,
  PRReviewThread,
} from '../../../../src/shared/types'

const REPO_PATH = '/repos/proj'
const PR_NUMBER = 7

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
  listCollaborators: vi.fn().mockResolvedValue([]),
  requestReviewer: vi.fn(),
  removeReviewer: vi.fn(),
  replyThread: vi.fn().mockResolvedValue(undefined),
  resolveThread: vi.fn().mockResolvedValue(undefined),
  unresolveThread: vi.fn().mockResolvedValue(undefined),
  applySuggestion: vi.fn(),
  getFileBlob: vi.fn(),
}

const makeComment = (overrides: Partial<PRComment>): PRComment => ({
  id: 1,
  body: 'comment body',
  path: 'src/foo.ts',
  line: 10,
  side: 'RIGHT',
  author: 'alice',
  createdAt: new Date().toISOString(),
  ...overrides,
})

const makeThread = (overrides: Partial<PRReviewThread>): PRReviewThread => ({
  id: 'PRRT_1',
  path: 'src/foo.ts',
  line: 10,
  startLine: null,
  side: 'RIGHT',
  isResolved: false,
  rootCommentId: 1,
  comments: [makeComment({ id: 1, body: 'Should this use Number()?' })],
  ...overrides,
})

const makeDetail = (): PRDetail => ({
  number: PR_NUMBER,
  title: 'Test PR',
  body: 'PR description',
  author: 'alice',
  authorAssociation: 'OWNER',
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefName: 'feat/x',
  headRefOid: 'abc',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  url: 'https://example/pr/7',
  labels: [],
  assignees: [],
  requestedReviewers: [],
  reviews: [],
} as unknown as PRDetail)

function seedStores(threads: PRReviewThread[], extra: Partial<ReturnType<typeof usePRReviewStore.getState>> = {}) {
  useProjectStore.setState({
    projects: [{ id: 'proj-1', name: 'proj', repoPath: REPO_PATH } as any],
    activeProjectId: 'proj-1',
    claudeAccounts: [],
  } as any)

  usePRReviewStore.setState({
    prNumber: PR_NUMBER,
    detail: makeDetail(),
    conversationComments: [],
    checks: [],
    checksPolling: false,
    reviewThreads: threads,
    collaborators: [],
    reviewerLoading: false,
    ...extra,
  } as any)
}

beforeEach(() => {
  for (const fn of Object.values(apiMocks)) (fn as any).mockReset?.()
  apiMocks.listCollaborators.mockResolvedValue([])
  apiMocks.replyThread.mockResolvedValue({
    id: 9999,
    body: 'reply',
    path: 'src/foo.ts',
    line: 10,
    side: 'RIGHT',
    author: 'me',
    createdAt: new Date().toISOString(),
  } satisfies PRComment)
  apiMocks.resolveThread.mockResolvedValue(undefined)
  apiMocks.unresolveThread.mockResolvedValue(undefined)
  ;(window as any).api = { github: apiMocks }
  usePRReviewStore.getState().clear()
})

describe('PRConversationTab — review threads section', () => {
  it('renders nothing when there are no review threads', () => {
    seedStores([])
    render(<PRConversationTab />)
    expect(screen.queryByText(/Review comments/i)).not.toBeInTheDocument()
  })

  it('renders the header with total and unresolved counts', () => {
    seedStores([
      makeThread({ id: 'a', isResolved: false }),
      makeThread({ id: 'b', isResolved: true, path: 'src/bar.ts' }),
    ])
    render(<PRConversationTab />)
    expect(screen.getByText(/Review comments \(2/)).toBeInTheDocument()
    expect(screen.getByText(/1 unresolved/)).toBeInTheDocument()
  })

  it('groups threads by file path', () => {
    seedStores([
      makeThread({ id: 'a', path: 'src/foo.ts', line: 5 }),
      makeThread({ id: 'b', path: 'src/foo.ts', line: 9 }),
      makeThread({ id: 'c', path: 'src/bar.ts', line: 1 }),
    ])
    render(<PRConversationTab />)
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
    expect(screen.getByText('src/bar.ts')).toBeInTheDocument()
  })

  it('shows "Line N" for single-line threads and "Lines N–M" for multi-line', () => {
    seedStores([
      makeThread({ id: 'a', line: 12, startLine: null }),
      makeThread({ id: 'b', line: 20, startLine: 17, path: 'src/multi.ts' }),
    ])
    render(<PRConversationTab />)
    expect(screen.getByText('Line 12')).toBeInTheDocument()
    expect(screen.getByText('Lines 17–20')).toBeInTheDocument()
  })

  it('calls resolveThread on the store when "Resolve" is clicked', async () => {
    const user = userEvent.setup()
    seedStores([makeThread({ id: 'PRRT_resolve_me', isResolved: false })])
    render(<PRConversationTab />)
    await user.click(screen.getByRole('button', { name: 'Resolve' }))
    expect(apiMocks.resolveThread).toHaveBeenCalledWith(REPO_PATH, 'PRRT_resolve_me')
  })

  it('calls unresolveThread on the store when "Unresolve" is clicked on a resolved thread', async () => {
    const user = userEvent.setup()
    seedStores([makeThread({ id: 'PRRT_unresolve_me', isResolved: true })])
    render(<PRConversationTab />)
    // resolved+collapsed shows "Expand" first; expand then unresolve
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    await user.click(screen.getByRole('button', { name: 'Unresolve' }))
    expect(apiMocks.unresolveThread).toHaveBeenCalledWith(REPO_PATH, 'PRRT_unresolve_me')
  })

  it('replies to a thread via the store, forwarding the root comment id and trimmed body', async () => {
    const user = userEvent.setup()
    seedStores([
      makeThread({
        id: 'PRRT_reply',
        rootCommentId: 555,
        comments: [makeComment({ id: 555, body: 'top' })],
      }),
    ])
    render(<PRConversationTab />)
    await user.click(screen.getByRole('button', { name: 'Reply' }))
    const textarea = await screen.findByPlaceholderText(/Reply to this thread/i)
    await user.type(textarea, '  Sounds good  ')
    // Submit via Cmd+Enter to avoid ambiguity with the "Reply" toggle button label
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(apiMocks.replyThread).toHaveBeenCalledWith(REPO_PATH, PR_NUMBER, 555, 'Sounds good')
  })

  it('shows the empty-state copy only when both issue comments and review threads are empty', () => {
    seedStores([], { conversationComments: [] } as any)
    const { rerender } = render(<PRConversationTab />)
    expect(screen.getByText(/No comments yet/i)).toBeInTheDocument()

    seedStores([makeThread({ id: 'x' })], { conversationComments: [] } as any)
    rerender(<PRConversationTab />)
    expect(screen.queryByText(/No comments yet/i)).not.toBeInTheDocument()
  })

  it('renders the body of the root review comment so users can read it inline', () => {
    seedStores([
      makeThread({
        id: 'PRRT_body',
        comments: [makeComment({ id: 9, body: 'Inline review feedback here' })],
      }),
    ])
    render(<PRConversationTab />)
    const fileGroup = screen.getByText('src/foo.ts').parentElement!
    expect(within(fileGroup).getByText(/Inline review feedback here/)).toBeInTheDocument()
  })
})

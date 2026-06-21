import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ReviewLoopPanel } from '../../../../src/renderer/components/review-loop/ReviewLoopPanel'
import { useReviewLoopStore } from '../../../../src/renderer/stores/reviewLoopStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { usePRStore } from '../../../../src/renderer/stores/prStore'
import { DEFAULT_REVIEW_LOOP_CONFIG, type ReviewLoopRound, type ReviewLoopState } from '../../../../src/shared/types'

// Render the live terminal as a lightweight stub so we don't pull in xterm /
// window.api.terminal — we only care that a column binds to its terminal id.
vi.mock('../../../../src/renderer/components/terminal/TerminalView', () => ({
  TerminalView: ({ terminalId }: { terminalId: string }) => (
    <div data-testid="terminal-view">{terminalId}</div>
  ),
}))

const round = (index: number, slots: ReviewLoopRound['phaseSlots']): ReviewLoopRound => ({
  index,
  startedAt: '2026-04-30T13:00:00Z',
  phase: 'idle',
  phaseSlots: slots,
  rawIssues: [],
  triaged: [],
  log: [],
})

const state = (over: Partial<ReviewLoopState> = {}): ReviewLoopState => ({
  sessionId: 's1',
  branch: 'feat/x',
  baseBranch: 'main',
  worktreePath: '/wt',
  variant: 'lite',
  status: 'running',
  currentPhase: 'triage',
  iteration: 2,
  skippedIssues: [],
  rounds: [
    round(1, [
      { phase: 'review', status: 'completed', terminalId: 't-r1-review', tabId: 'review-loop:r1:review' },
      { phase: 'triage', status: 'completed', terminalId: 't-r1-triage', tabId: 'review-loop:r1:triage' },
      { phase: 'fix', status: 'completed', terminalId: 't-r1-fix', tabId: 'review-loop:r1:fix' },
    ]),
    round(2, [
      { phase: 'review', status: 'completed', terminalId: 't-r2-review', tabId: 'review-loop:r2:review' },
      { phase: 'triage', status: 'running', terminalId: 't-r2-triage', tabId: 'review-loop:r2:triage' },
      { phase: 'fix', status: 'pending' },
    ]),
  ],
  ...over,
})

beforeEach(() => {
  ;(window as any).api = {
    reviewLoop: { getState: vi.fn(async () => null) }, // refreshState keeps the seeded state
  }
  useReviewLoopStore.setState({
    settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG }, projectOverrides: {} },
    loaded: true,
    states: { s1: state() },
  })
  useSessionStore.setState({
    activeSessionId: 's1',
    sessions: [
      { id: 's1', name: 'sess', branchName: 'feat/x', worktreePath: '/wt', baseBranch: 'main' } as any,
    ],
  } as any)
  useProjectStore.setState({
    activeProjectId: 'p1',
    projects: [{ id: 'p1', name: 'Proj', repoPath: '/repo' } as any],
  } as any)
  usePRStore.setState({ pullRequests: [] } as any)
})

describe('ReviewLoopPanel', () => {
  it('renders a row of three labelled phase columns per round', () => {
    render(<ReviewLoopPanel />)
    // 2 rounds × (Review, Triage, Implementation)
    expect(screen.getAllByText('Review')).toHaveLength(2)
    expect(screen.getAllByText('Triage')).toHaveLength(2)
    expect(screen.getAllByText('Implementation')).toHaveLength(2)
    // "Round 1" is the round-1 header; "Round 2" also appears in the summary bar
    // (Round {iteration}), so it shows more than once.
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getAllByText('Round 2').length).toBeGreaterThanOrEqual(1)
  })

  it('binds each spawned phase to its terminal id', () => {
    render(<ReviewLoopPanel />)
    const terms = screen.getAllByTestId('terminal-view').map((n) => n.textContent)
    // 5 phases have a terminal id; the pending fix of round 2 does not.
    expect(terms).toContain('t-r1-review')
    expect(terms).toContain('t-r2-triage')
    expect(terms).toHaveLength(5)
  })

  it('overlays a read-only Completed badge on finished phases', () => {
    render(<ReviewLoopPanel />)
    // round 1 has 3 completed phases; round 2 review is also completed → 4.
    expect(screen.getAllByText(/Completed — read-only/i)).toHaveLength(4)
  })

  it('shows a waiting placeholder for a not-yet-started phase', () => {
    render(<ReviewLoopPanel />)
    expect(screen.getByText(/Waiting to start/i)).toBeInTheDocument()
  })

  it('offers a Cancel action while the loop is running', () => {
    render(<ReviewLoopPanel />)
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
  })

  it('shows the Start action and intro when no loop has run', () => {
    useReviewLoopStore.setState({ states: {} })
    render(<ReviewLoopPanel />)
    expect(screen.getByRole('button', { name: /Start review loop/i })).toBeInTheDocument()
    expect(screen.getByText(/three live Claude Code terminals/i)).toBeInTheDocument()
  })
})

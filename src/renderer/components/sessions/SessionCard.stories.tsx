import type { Meta, StoryObj } from '@storybook/react'
import { AssignPRDialog, SessionCard } from './SessionCard'
import type { PullRequest } from '../../../shared/types'

const baseSession = {
  id: 'sess-1',
  name: 'add-pr-review',
  branchName: 'session/add-pr-review',
  worktreePath: '/mock/worktree',
  projectId: 'proj-1',
  createdAt: new Date().toISOString(),
  lastActiveAt: new Date().toISOString(),
  baseBranch: 'main',
}

const basePR: PullRequest = {
  number: 42,
  title: 'Add PR review panel with conversation and checks',
  headRefName: 'session/add-pr-review',
  baseRefName: 'main',
  author: 'alice',
  assignees: ['alice'],
  requestedReviewers: ['bob'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isDraft: false,
  state: 'OPEN',
  ciStatus: 'success',
  labels: [],
  commentsCount: 0,
  reviews: [],
}

const noop = () => {}

const meta: Meta<typeof SessionCard> = {
  title: 'Sessions/SessionCard',
  component: SessionCard,
  parameters: { layout: 'centered' },
  decorators: [(Story) => <div style={{ width: 224, padding: 16, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}><Story /></div>],
  args: {
    session: baseSession,
    isActive: false,
    isOpenedAsMain: false,
    status: null,
    onClick: noop,
    onOpenAsMainBranch: noop,
    onDelete: noop,
    onRename: async () => {},
  },
}
export default meta

type Story = StoryObj<typeof SessionCard>

export const Default: Story = {}

export const Active: Story = {
  args: { isActive: true },
}

export const Running: Story = {
  args: { status: 'running' },
}

export const Attention: Story = {
  args: { status: 'attention' },
}

export const Completed: Story = {
  args: { status: 'completed' },
}

export const WithPR: Story = {
  args: { isActive: true, pr: basePR, status: 'running' },
}

export const WithDraftPR: Story = {
  args: { pr: { ...basePR, isDraft: true, title: 'WIP: Add code editor' } },
}

export const WithNotionTicket: Story = {
  args: {
    session: {
      ...baseSession,
      notionTicket: {
        pageId: 'abc123',
        url: 'https://www.notion.so/Add-PR-review-panel-abc123',
        title: 'Add PR review panel with conversation and checks',
      },
    },
  },
}

export const WithMergedPR: Story = {
  args: {
    pr: {
      ...basePR,
      state: 'MERGED' as const,
      ciStatus: 'success' as const,
      title: 'Add merged PR tracking',
    },
  },
}

export const Cloud: Story = {
  args: {
    session: {
      ...baseSession,
      location: 'cloud',
      cloud: { sessionId: 'session_01abc', url: 'https://claude.ai/code/session_01abc' },
    },
    status: 'running',
  },
}

export const RepoAgent: Story = {
  args: {
    session: {
      ...baseSession,
      name: 'agent-1',
      branchName: '',
      worktreePath: '/mock/repo',
      repoRoot: true,
    },
    repoBranch: 'main',
    status: 'running',
  },
}

/** A no-worktree agent after Haiku named it from its first message. */
export const RepoAgentNamed: Story = {
  args: {
    session: {
      ...baseSession,
      name: 'pr-143-image-upload-check',
      branchName: '',
      worktreePath: '/mock/repo',
      repoRoot: true,
    },
    repoBranch: 'main',
    status: 'running',
  },
}

/**
 * Sessions started by another session's agent through the `crucible`
 * dispatch_session tool: a no-worktree planning chat and the two sessions it
 * handed work off to (one local, one in the cloud).
 */
export const Dispatched: Story = {
  render: (args) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <SessionCard
        {...args}
        session={{ ...baseSession, id: 'sess-0', name: 'Planning chat', branchName: '', worktreePath: '/mock/repo', repoRoot: true }}
        repoBranch="main"
        status="completed"
      />
      <SessionCard
        {...args}
        session={{
          ...baseSession,
          name: 'Fix login redirect',
          branchName: 'session/fix-login-redirect',
          dispatchedBy: { sessionId: 'sess-0', name: 'Planning chat' },
        }}
        status="running"
      />
      <SessionCard
        {...args}
        session={{
          ...baseSession,
          id: 'sess-2',
          name: 'Add dark mode toggle',
          branchName: 'session/add-dark-mode-toggle',
          location: 'cloud',
          cloud: { sessionId: 'session_01abc', url: 'https://claude.ai/code/session_01abc' },
          dispatchedBy: { sessionId: 'sess-0', name: 'Planning chat' },
        }}
        status="running"
      />
    </div>
  ),
}

const assignablePRs: PullRequest[] = [
  { ...basePR, number: 156, title: 'Assign PRs to sessions with no worktree', headRefName: 'pr-assign' },
  { ...basePR, number: 155, title: 'Fix login redirect on expired sessions', headRefName: 'session/fix-login-redirect', isDraft: true, ciStatus: 'pending' },
  { ...basePR, number: 154, title: "Give PR Desk's expanded view a row per Notion project", headRefName: 'session/pr-desk-built-in', state: 'MERGED' },
]

/** A no-worktree agent with a PR assigned to it (it opened the PR from the main checkout). */
export const RepoAgentAssignedPR: Story = {
  args: {
    session: {
      ...baseSession,
      name: 'Planning chat',
      branchName: '',
      worktreePath: '/mock/repo',
      repoRoot: true,
      prNumber: 156,
    },
    repoBranch: 'pr-assign',
    pr: assignablePRs[0],
    assignablePRs,
    onAssignPR: async () => {},
    status: 'completed',
  },
}

/** The Assign pull request dialog from a no-worktree agent's ⋯ menu. */
export const AssignPRDialogOpen: Story = {
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div style={{ width: 600, height: 520 }}><Story /></div>],
  render: () => (
    <AssignPRDialog
      open
      sessionName="Planning chat"
      pullRequests={assignablePRs}
      onClose={noop}
      onAssign={async () => {}}
    />
  ),
}

/** A session started in audio mode: its replies are read aloud. */
export const AudioMode: Story = {
  args: {
    session: { ...baseSession, name: 'voice-walkthrough', branchName: 'feat/voice-walkthrough', audioMode: true },
    isActive: true,
    status: 'running',
  },
}

import type {
  Project,
  Session,
  Commit,
  FileDiff,
  PullRequest,
  PRFile,
  PRComment,
  PRDetail,
  PRConversationComment,
  PRCheck,
  PRReviewThread,
  SessionUsage,
  UsageStats,
  SubscriptionInfo,
  Note,
  FileEntry,
  ClaudeAccount,
} from '../src/shared/types'

// --- Accounts ---

export const mockAccounts: ClaudeAccount[] = [
  { id: 'acc-1', label: 'Personal', configDir: '/Users/dev/.claude' },
  { id: 'acc-2', label: 'Work', configDir: '/Users/dev/.claude-work' },
]

// --- Projects ---

export const mockProjects: Project[] = [
  { id: 'proj-1', name: 'CodeCrucible', repoPath: '/Users/dev/repos/CodeCrucible', claudeAccountId: 'acc-1' },
  { id: 'proj-2', name: 'my-api-service', repoPath: '/Users/dev/repos/my-api-service', claudeAccountId: 'acc-2' },
  { id: 'proj-3', name: 'design-system', repoPath: '/Users/dev/repos/design-system' },
]

// --- Sessions ---

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString()
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()

export const mockSessions: Record<string, Session[]> = {
  'proj-1': [
    {
      id: 'sess-1',
      name: 'add-pr-review',
      branchName: 'session/add-pr-review',
      worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/add-pr-review',
      projectId: 'proj-1',
      createdAt: daysAgo(3),
      lastActiveAt: hoursAgo(0.5),
      prNumber: 42,
      baseBranch: 'main',
    },
    {
      id: 'sess-2',
      name: 'fix-terminal-resize',
      branchName: 'session/fix-terminal-resize',
      worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/fix-terminal-resize',
      projectId: 'proj-1',
      createdAt: daysAgo(1),
      lastActiveAt: hoursAgo(2),
      baseBranch: 'main',
    },
    {
      id: 'sess-3',
      name: 'usage-tracking',
      branchName: 'session/usage-tracking',
      worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/usage-tracking',
      projectId: 'proj-1',
      createdAt: daysAgo(5),
      lastActiveAt: hoursAgo(6),
      baseBranch: 'main',
    },
    {
      id: 'sess-4',
      name: 'editor-view',
      branchName: 'session/editor-view',
      worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/editor-view',
      projectId: 'proj-1',
      createdAt: daysAgo(2),
      lastActiveAt: hoursAgo(1),
      baseBranch: 'main',
    },
  ],
  'proj-2': [
    {
      id: 'sess-5',
      name: 'auth-middleware',
      branchName: 'session/auth-middleware',
      worktreePath: '/Users/dev/.codecrucible-worktrees/my-api-service/auth-middleware',
      projectId: 'proj-2',
      createdAt: daysAgo(2),
      lastActiveAt: hoursAgo(4),
      baseBranch: 'main',
    },
    {
      id: 'sess-6',
      name: 'rate-limiting',
      branchName: 'session/rate-limiting',
      worktreePath: '/Users/dev/.codecrucible-worktrees/my-api-service/rate-limiting',
      projectId: 'proj-2',
      createdAt: daysAgo(1),
      lastActiveAt: hoursAgo(0.2),
      baseBranch: 'main',
    },
  ],
  'proj-3': [
    {
      id: 'sess-7',
      name: 'button-variants',
      branchName: 'session/button-variants',
      worktreePath: '/Users/dev/.codecrucible-worktrees/design-system/button-variants',
      projectId: 'proj-3',
      createdAt: daysAgo(4),
      lastActiveAt: hoursAgo(12),
      baseBranch: 'main',
    },
  ],
}

export const mockStaleSessions: Record<string, Session[]> = {
  'proj-1': [
    {
      id: 'sess-stale-1',
      name: 'old-sidebar-refactor',
      branchName: 'session/old-sidebar-refactor',
      worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/old-sidebar-refactor',
      projectId: 'proj-1',
      createdAt: daysAgo(14),
      lastActiveAt: daysAgo(10),
      staleAt: daysAgo(7),
      baseBranch: 'main',
    },
  ],
}

// --- Commits ---

export const mockCommits: Commit[] = [
  { hash: 'a1b2c3d', message: 'Add PR review panel with conversation tab', author: 'Alice', date: hoursAgo(1) },
  { hash: 'e4f5g6h', message: 'Add file tree with viewed-file tracking', author: 'Alice', date: hoursAgo(3) },
  { hash: 'i7j8k9l', message: 'Add checks tab with CI status display', author: 'Alice', date: hoursAgo(5) },
  { hash: 'm0n1o2p', message: 'Fix diff viewer for renamed files', author: 'Bob', date: hoursAgo(8) },
  { hash: 'q3r4s5t', message: 'Add syntax highlighting to diff viewer', author: 'Bob', date: hoursAgo(12) },
  { hash: 'u6v7w8x', message: 'Implement session status indicators', author: 'Alice', date: daysAgo(1) },
  { hash: 'y9z0a1b', message: 'Add notification badge to project tabs', author: 'Alice', date: daysAgo(1) },
  { hash: 'c2d3e4f', message: 'Add stale session detection and cleanup', author: 'Bob', date: daysAgo(2) },
  { hash: 'g5h6i7j', message: 'Fix terminal theme sync on settings change', author: 'Alice', date: daysAgo(2) },
  { hash: 'k8l9m0n', message: 'Add worktree creation from remote branch', author: 'Bob', date: daysAgo(3) },
  { hash: 'o1p2q3r', message: 'Implement draggable project tabs', author: 'Alice', date: daysAgo(3) },
  { hash: 's4t5u6v', message: 'Add usage tracking panel with rate limits', author: 'Bob', date: daysAgo(4) },
  { hash: 'w7x8y9z', message: 'Initial project setup with Electron + React', author: 'Alice', date: daysAgo(14) },
]

// --- File diffs ---

export const mockFileDiffs: FileDiff[] = [
  { filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx', status: 'added', insertions: 142, deletions: 0 },
  { filePath: 'src/renderer/components/pullrequests/PRConversationTab.tsx', status: 'added', insertions: 89, deletions: 0 },
  { filePath: 'src/renderer/components/pullrequests/FileTree.tsx', status: 'added', insertions: 67, deletions: 0 },
  { filePath: 'src/renderer/stores/prReviewStore.ts', status: 'added', insertions: 54, deletions: 0 },
  { filePath: 'src/renderer/components/layout/SessionWorkspace.tsx', status: 'modified', insertions: 23, deletions: 8 },
  { filePath: 'src/shared/types.ts', status: 'modified', insertions: 18, deletions: 2 },
  { filePath: 'src/main/ipc/github.ts', status: 'modified', insertions: 45, deletions: 12 },
  { filePath: 'src/renderer/components/git/OldDiffViewer.tsx', status: 'deleted', insertions: 0, deletions: 94 },
]

export const mockWorkingFiles: FileDiff[] = [
  { filePath: 'src/renderer/components/pullrequests/PRReviewPanel.tsx', status: 'modified', insertions: 5, deletions: 2 },
  { filePath: 'src/renderer/stores/prStore.ts', status: 'modified', insertions: 3, deletions: 1 },
]

// --- Unified diff string for DiffViewer ---

export const mockUnifiedDiff = `@@ -1,6 +1,8 @@
 import React from 'react'
+import { TabBar, Tab } from '../ui'
+import { PRConversationTab } from './PRConversationTab'
 import { useSessionStore } from '../../stores/sessionStore'
-import { usePRStore } from '../../stores/prStore'
+import { usePRReviewStore } from '../../stores/prReviewStore'

 export function PRReviewPanel() {
-  const { activePRNumber } = useSessionStore()
+  const { activePRNumber } = useSessionStore()
+  const { files, selectedFile, setSelectedFile } = usePRReviewStore()
+
+  if (!activePRNumber) return null
+
   return (
-    <div className="p-4">
-      <h2>PR #{activePRNumber}</h2>
+    <div className="flex flex-col h-full">
+      <TabBar>
+        <Tab label="Conversation" />
+        <Tab label="Files" />
+        <Tab label="Checks" />
+        <Tab label="Commits" />
+      </TabBar>
+      <div className="flex-1 min-h-0 flex">
+        <FileTree files={files} selected={selectedFile} onSelect={setSelectedFile} />
+        <PRConversationTab prNumber={activePRNumber} />
+      </div>
     </div>
   )
 }`

// --- Pull Requests ---

export const mockPullRequests: PullRequest[] = [
  {
    number: 42,
    title: 'Add PR review panel with conversation and checks',
    headRefName: 'session/add-pr-review',
    baseRefName: 'main',
    author: 'alice',
    updatedAt: hoursAgo(1),
    isDraft: false,
  },
  {
    number: 38,
    title: 'Fix terminal resize handling on split panes',
    headRefName: 'session/fix-terminal-resize',
    baseRefName: 'main',
    author: 'bob',
    updatedAt: hoursAgo(5),
    isDraft: false,
  },
  {
    number: 35,
    title: 'WIP: Add code editor with file explorer',
    headRefName: 'session/editor-view',
    baseRefName: 'main',
    author: 'alice',
    updatedAt: daysAgo(1),
    isDraft: true,
  },
]

export const mockPRDetail: PRDetail = {
  body: '## Summary\n\nAdds a full PR review panel with:\n- Conversation tab showing PR description and comments\n- Checks tab with CI/CD status\n- File tree with viewed tracking\n- Inline diff viewer\n\n## Test Plan\n- [x] Open a PR from the sidebar\n- [x] Verify conversation renders markdown\n- [x] Verify checks show pass/fail status\n- [x] Verify file tree marks viewed files',
  author: 'alice',
  title: 'Add PR review panel with conversation and checks',
  createdAt: daysAgo(3),
  baseRefName: 'main',
  headRefName: 'session/add-pr-review',
}

export const mockPRFiles: PRFile[] = [
  { path: 'src/renderer/components/pullrequests/PRReviewPanel.tsx', additions: 142, deletions: 0, status: 'added' },
  { path: 'src/renderer/components/pullrequests/PRConversationTab.tsx', additions: 89, deletions: 0, status: 'added' },
  { path: 'src/renderer/components/pullrequests/FileTree.tsx', additions: 67, deletions: 0, status: 'added' },
  { path: 'src/renderer/stores/prReviewStore.ts', additions: 54, deletions: 0, status: 'added' },
  { path: 'src/renderer/components/layout/SessionWorkspace.tsx', additions: 23, deletions: 8, status: 'modified' },
  { path: 'src/shared/types.ts', additions: 18, deletions: 2, status: 'modified' },
]

export const mockPRConversationComments: PRConversationComment[] = [
  {
    id: 1,
    body: 'This looks great! The tab structure is clean and the file tree is a nice touch. One question: should we add keyboard navigation to the file tree?',
    author: 'bob',
    createdAt: hoursAgo(2),
    authorAssociation: 'COLLABORATOR',
  },
  {
    id: 2,
    body: 'Good call — I\'ll add arrow key navigation using the existing `useRovingIndex` hook. Should be straightforward since `ListBox` already supports it.',
    author: 'alice',
    createdAt: hoursAgo(1),
    authorAssociation: 'OWNER',
  },
]

export const mockPRChecks: PRCheck[] = [
  { name: 'build', status: 'completed', conclusion: 'success', startedAt: hoursAgo(2), completedAt: hoursAgo(1.9), detailsUrl: null },
  { name: 'lint', status: 'completed', conclusion: 'success', startedAt: hoursAgo(2), completedAt: hoursAgo(1.95), detailsUrl: null },
  { name: 'typecheck', status: 'completed', conclusion: 'success', startedAt: hoursAgo(2), completedAt: hoursAgo(1.85), detailsUrl: null },
  { name: 'e2e-tests', status: 'in_progress', conclusion: null, startedAt: hoursAgo(0.5), completedAt: null, detailsUrl: null },
]

export const mockPRReviewThreads: PRReviewThread[] = [
  { path: 'src/renderer/components/pullrequests/PRReviewPanel.tsx', line: 42, isResolved: false },
  { path: 'src/renderer/stores/prReviewStore.ts', line: 15, isResolved: true },
]

export const mockPRComments: PRComment[] = [
  {
    id: 101,
    body: 'Consider memoizing this callback to avoid re-renders',
    path: 'src/renderer/components/pullrequests/PRReviewPanel.tsx',
    line: 42,
    side: 'RIGHT',
    author: 'bob',
    createdAt: hoursAgo(2),
  },
]

export const mockPRCommits: Commit[] = [
  { hash: 'abc123', message: 'Add basic PR review panel skeleton', author: 'alice', date: daysAgo(3) },
  { hash: 'def456', message: 'Add conversation tab with markdown rendering', author: 'alice', date: daysAgo(2) },
  { hash: 'ghi789', message: 'Add checks tab and file tree', author: 'alice', date: daysAgo(1) },
  { hash: 'jkl012', message: 'Add viewed-file tracking and keyboard nav', author: 'alice', date: hoursAgo(3) },
]

// --- Usage ---

export const mockSessionUsage: SessionUsage = {
  sessionId: 'sess-1',
  rateLimits: {
    fiveHour: { usedPercentage: 34, resetsAt: Math.floor(Date.now() / 1000) + 12000 },
    sevenDay: { usedPercentage: 12, resetsAt: Math.floor(Date.now() / 1000) + 400000 },
  },
  cost: {
    totalCostUsd: 2.47,
    totalDurationMs: 1800000,
    totalApiDurationMs: 900000,
    totalLinesAdded: 342,
    totalLinesRemoved: 87,
  },
  updatedAt: Date.now(),
}

export const mockUsageStats: UsageStats = {
  dailyActivity: [
    { date: daysAgo(6).split('T')[0], messageCount: 45, sessionCount: 3, toolCallCount: 120 },
    { date: daysAgo(5).split('T')[0], messageCount: 62, sessionCount: 4, toolCallCount: 180 },
    { date: daysAgo(4).split('T')[0], messageCount: 38, sessionCount: 2, toolCallCount: 95 },
    { date: daysAgo(3).split('T')[0], messageCount: 71, sessionCount: 5, toolCallCount: 210 },
    { date: daysAgo(2).split('T')[0], messageCount: 55, sessionCount: 3, toolCallCount: 150 },
    { date: daysAgo(1).split('T')[0], messageCount: 83, sessionCount: 6, toolCallCount: 240 },
    { date: now.toISOString().split('T')[0], messageCount: 29, sessionCount: 2, toolCallCount: 78 },
  ],
  totalSessions: 47,
  totalMessages: 1250,
}

export const mockSubscription: SubscriptionInfo = {
  subscriptionType: 'max_5x',
  rateLimitTier: 'tier_4',
}

// --- Notes ---

export const mockNotes: Note[] = [
  {
    id: 'note-1',
    title: 'PR Review Checklist',
    content: '- Check for proper error handling\n- Verify keyboard navigation\n- Ensure toast messages show raw errors\n- Test with large PRs (300+ files)',
    createdAt: daysAgo(5),
    updatedAt: daysAgo(1),
  },
  {
    id: 'note-2',
    title: 'Architecture Notes',
    content: 'All IPC channels in shared/constants.ts\nRenderer → preload → main process\nZustand for all state management',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(3),
  },
]

// --- File tree ---

export const mockFileTree: FileEntry[] = [
  { name: 'src', path: '/Users/dev/repos/CodeCrucible/src', isDirectory: true },
  { name: 'package.json', path: '/Users/dev/repos/CodeCrucible/package.json', isDirectory: false },
  { name: 'tsconfig.json', path: '/Users/dev/repos/CodeCrucible/tsconfig.json', isDirectory: false },
  { name: 'README.md', path: '/Users/dev/repos/CodeCrucible/README.md', isDirectory: false },
  { name: 'electron.vite.config.ts', path: '/Users/dev/repos/CodeCrucible/electron.vite.config.ts', isDirectory: false },
]

export const mockFileTreeSrc: FileEntry[] = [
  { name: 'main', path: '/Users/dev/repos/CodeCrucible/src/main', isDirectory: true },
  { name: 'preload', path: '/Users/dev/repos/CodeCrucible/src/preload', isDirectory: true },
  { name: 'renderer', path: '/Users/dev/repos/CodeCrucible/src/renderer', isDirectory: true },
  { name: 'shared', path: '/Users/dev/repos/CodeCrucible/src/shared', isDirectory: true },
]

export const mockFileTreeRenderer: FileEntry[] = [
  { name: 'App.tsx', path: '/Users/dev/repos/CodeCrucible/src/renderer/App.tsx', isDirectory: false },
  { name: 'index.tsx', path: '/Users/dev/repos/CodeCrucible/src/renderer/index.tsx', isDirectory: false },
  { name: 'components', path: '/Users/dev/repos/CodeCrucible/src/renderer/components', isDirectory: true },
  { name: 'stores', path: '/Users/dev/repos/CodeCrucible/src/renderer/stores', isDirectory: true },
  { name: 'hooks', path: '/Users/dev/repos/CodeCrucible/src/renderer/hooks', isDirectory: true },
  { name: 'styles', path: '/Users/dev/repos/CodeCrucible/src/renderer/styles', isDirectory: true },
  { name: 'types', path: '/Users/dev/repos/CodeCrucible/src/renderer/types', isDirectory: true },
]

// --- Mock file content for editor ---

export const mockFileContent = `import React, { useEffect, useState } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { SessionWorkspace } from './components/layout/SessionWorkspace'
import { EditorWorkspace } from './components/editor/EditorWorkspace'
import { useEditorStore } from './stores/editorStore'
import { RightActivityBar } from './components/layout/RightActivityBar'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'

export default function App() {
  const { loadProjects, loadAccounts, projects } = useProjectStore()
  const { activeSessionId } = useSessionStore()
  const { editorMode } = useEditorStore()

  useEffect(() => {
    Promise.all([loadProjects(), loadAccounts()])
  }, [loadProjects, loadAccounts])

  return (
    <div className="h-full flex flex-col">
      <ProjectTabs />
      <div className="flex-1 flex min-h-0">
        <SessionSidebar />
        {editorMode ? <EditorWorkspace /> : <SessionWorkspace />}
        <RightActivityBar />
      </div>
    </div>
  )
}
`

// --- Terminal output simulation ---

export const mockTerminalOutput = [
  '\x1b[1;34m╭─\x1b[0m\x1b[1;34m────────────────────────────────────────────────────╮\x1b[0m\r\n',
  '\x1b[1;34m│\x1b[0m \x1b[1;37mClaude Code\x1b[0m \x1b[2mv1.0.23\x1b[0m                                   \x1b[1;34m│\x1b[0m\r\n',
  '\x1b[1;34m╰─\x1b[0m\x1b[1;34m────────────────────────────────────────────────────╯\x1b[0m\r\n',
  '\r\n',
  '\x1b[2mTip: Use /help for available commands\x1b[0m\r\n',
  '\r\n',
  '\x1b[1;36m>\x1b[0m Add a PR review panel with conversation tab, checks, and file tree\r\n',
  '\r\n',
  '\x1b[1;33m⏺\x1b[0m I\'ll implement the PR review panel. Let me start by examining the existing code.\r\n',
  '\r\n',
  '  \x1b[2mReading\x1b[0m src/renderer/components/layout/SessionWorkspace.tsx\r\n',
  '  \x1b[2mReading\x1b[0m src/shared/types.ts\r\n',
  '  \x1b[2mReading\x1b[0m src/renderer/stores/sessionStore.ts\r\n',
  '\r\n',
  '\x1b[1;33m⏺\x1b[0m I\'ll create the PR review panel with the following structure:\r\n',
  '\r\n',
  '  1. \x1b[1mPRReviewPanel\x1b[0m — main container with tab navigation\r\n',
  '  2. \x1b[1mPRConversationTab\x1b[0m — PR description, timeline, comments\r\n',
  '  3. \x1b[1mFileTree\x1b[0m — file list with viewed tracking\r\n',
  '  4. \x1b[1mPRChecksTab\x1b[0m — CI/CD status display\r\n',
  '\r\n',
  '  \x1b[32mCreating\x1b[0m src/renderer/components/pullrequests/PRReviewPanel.tsx\r\n',
  '  \x1b[32mCreating\x1b[0m src/renderer/components/pullrequests/PRConversationTab.tsx\r\n',
  '  \x1b[32mCreating\x1b[0m src/renderer/components/pullrequests/FileTree.tsx\r\n',
  '  \x1b[32mCreating\x1b[0m src/renderer/stores/prReviewStore.ts\r\n',
  '  \x1b[33mEditing\x1b[0m  src/renderer/components/layout/SessionWorkspace.tsx\r\n',
  '  \x1b[33mEditing\x1b[0m  src/shared/types.ts\r\n',
  '\r\n',
  '\x1b[1;33m⏺\x1b[0m The PR review panel is now complete. Here\'s what I built:\r\n',
  '\r\n',
  '  \x1b[1;32m✓\x1b[0m Conversation tab with markdown rendering\r\n',
  '  \x1b[1;32m✓\x1b[0m Checks tab showing CI status (pass/fail/pending)\r\n',
  '  \x1b[1;32m✓\x1b[0m File tree with viewed-file tracking\r\n',
  '  \x1b[1;32m✓\x1b[0m Inline diff viewer with syntax highlighting\r\n',
  '  \x1b[1;32m✓\x1b[0m Keyboard navigation via useRovingIndex\r\n',
  '\r\n',
  '  \x1b[2mFiles: 4 created, 2 modified (+394/-22 lines)\x1b[0m\r\n',
  '\r\n',
  '\x1b[1;36m>\x1b[0m ',
]

import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useGitStore } from '../../stores/gitStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePRStore } from '../../stores/prStore'
import { usePRViewStore } from '../../stores/prViewStore'
import { usePRReviewStore } from '../../stores/prReviewStore'
import { useEditorStore } from '../../stores/editorStore'
import { useUsageStore } from '../../stores/usageStore'
import { useNotesStore } from '../../stores/notesStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useWorkspaceLayoutStore, type WorkspaceTab } from '../../stores/workspaceLayoutStore'
import { useButtonStore } from '../../stores/buttonStore'
import type { SessionStatus } from '../../../shared/types'

import {
  mockProjects,
  mockAccounts,
  mockSessions,
  mockStaleSessions,
  mockCommits,
  mockFileDiffs,
  mockWorkingFiles,
  mockUnifiedDiff,
  mockPullRequests,
  mockPRDetail,
  mockPRFiles,
  mockPRConversationComments,
  mockPRChecks,
  mockPRCommits,
  mockPRReviewThreads,
  mockPRComments,
  mockSessionUsage,
  mockUsageStats,
  mockSubscription,
  mockNotes,
  mockFileContent,
  mockButtons,
  mockButtonGroups,
} from '@mock/mockData'

interface StorySetupOptions {
  activeProjectId?: string
  activeSessionId?: string
  activeWorkspaceTab?: 'agent' | 'git' | 'pr'
  activePRNumber?: number | null
  editorMode?: boolean
  /** Active tab inside the Code (editor) workspace. Defaults to 'code'. */
  editorActiveTab?: 'code' | 'git'
  settingsOpen?: boolean
  /** Session statuses to show in sidebar — shorthand for default 'agent' tab in each context */
  sessionStatuses?: Record<string, SessionStatus>
  /** Per-(contextId, tabId) statuses — use this when you need code-editor:* / __pr__:* contexts or non-'agent' tabs. */
  contextStatuses?: Record<string, Record<string, SessionStatus>>
  /** Workspace tabs to seed for the default layout (e.g. ['agent', 'agent:1', 'git']) */
  workspaceTabs?: WorkspaceTab[]
  /** Set to a session ID to show the "opened as main branch" banner */
  openedAsMainBranch?: string | null
  /** Whether uncommitted changes were stashed when opening as main */
  didStash?: boolean
}

export function setupStoresForStory(options: StorySetupOptions = {}) {
  const projectId = options.activeProjectId ?? 'proj-1'
  const sessionId = options.activeSessionId ?? 'sess-1'

  // Project store
  useProjectStore.setState({
    projects: mockProjects,
    activeProjectId: projectId,
    claudeAccounts: mockAccounts,
  })

  // Session store
  const activeSessionForStore = options.activePRNumber ? null : sessionId
  useSessionStore.setState({
    sessions: mockSessions[projectId] ?? [],
    staleSessions: mockStaleSessions[projectId] ?? [],
    currentProjectId: projectId,
    activeSessionId: activeSessionForStore,
    activePRNumber: options.activePRNumber ?? null,
    activeWorkspaceTab: options.activeWorkspaceTab ?? 'agent',
    openedAsMainBranch: options.openedAsMainBranch ?? null,
    previousMainBranch: null,
    detachedWorktree: null,
    didStash: options.didStash ?? false,
  })

  // Seed localStorage so sessionStore.loadSessions() restores the right context
  // when App.tsx triggers it on mount
  const savedContexts: Record<string, any> = {}
  savedContexts[projectId] = {
    sessionId: activeSessionForStore,
    prNumber: options.activePRNumber ?? null,
    openedAsMainBranch: options.openedAsMainBranch ?? null,
    previousMainBranch: null,
    detachedWorktree: null,
    didStash: options.didStash ?? false,
  }
  localStorage.setItem('codecrucible-last-active-context', JSON.stringify(savedContexts))

  // Git store
  useGitStore.setState({
    commits: mockCommits,
    changedFiles: mockFileDiffs,
    workingFiles: mockWorkingFiles,
    selectedCommitHash: mockCommits[0]?.hash ?? null,
    selectedFilePath: mockFileDiffs[0]?.filePath ?? null,
    filePatch: mockUnifiedDiff,
    loading: false,
    commitStatuses: { unpushedHashes: ['a1b2c3d', 'e4f5g6h'], newBranchHashes: [] },
  })

  // Notification store — show visual variety
  const contextStatuses = new Map<string, Map<string, SessionStatus>>()
  const statuses = options.sessionStatuses ?? {
    'sess-1': 'running',
    'sess-2': 'attention',
    'sess-3': 'completed',
  }
  for (const [id, status] of Object.entries(statuses)) {
    contextStatuses.set(id, new Map([['agent', status as SessionStatus]]))
  }
  if (options.contextStatuses) {
    for (const [ctxId, tabs] of Object.entries(options.contextStatuses)) {
      const tabMap = contextStatuses.get(ctxId) ?? new Map<string, SessionStatus>()
      for (const [tabId, status] of Object.entries(tabs)) {
        tabMap.set(tabId, status as SessionStatus)
      }
      contextStatuses.set(ctxId, tabMap)
    }
  }
  const projectMap = new Map<string, string>()
  for (const sessions of Object.values(mockSessions)) {
    for (const s of sessions) {
      projectMap.set(s.id, s.projectId)
    }
  }
  useNotificationStore.setState({
    contextStatuses,
    sessionProjectMap: projectMap,
  })

  // App.tsx has an auto-clear effect that wipes attention on the active session
  // when it mounts. For Storybook screenshots we want the attention state to
  // remain visible, so we re-apply the configured statuses after the effect
  // has had a chance to run.
  if (typeof window !== 'undefined') {
    setTimeout(() => {
      useNotificationStore.setState({ contextStatuses: new Map(contextStatuses) })
    }, 200)
  }

  // PR store
  const repoPath = mockProjects[0]?.repoPath ?? '/mock/repo'
  usePRStore.setState({
    pullRequests: mockPullRequests,
    seenPRs: [],
    loading: false,
    hasLoaded: true,
    prCache: {},
    seenCache: {},
    collaboratorsCache: {
      [repoPath]: [
        { login: 'alice' },
        { login: 'bob' },
        { login: 'carol' },
        { login: 'dave' },
        { login: 'mattmoran' },
      ],
    },
    currentRepoPath: null,
    currentProjectId: null,
    currentUser: 'mattmoran',
  })

  // PR review store (for PR review view)
  if (options.activePRNumber) {
    usePRReviewStore.setState({
      prNumber: options.activePRNumber,
      files: mockPRFiles,
      selectedFilePath: mockPRFiles[0]?.path ?? null,
      fullDiff: mockUnifiedDiff,
      fileDiffCache: {},
      fileDiffLoading: null,
      comments: mockPRComments,
      mergeable: 'MERGEABLE',
      loading: false,
      reviewLoading: false,
      mergeLoading: false,
      detail: mockPRDetail,
      conversationComments: mockPRConversationComments,
      checks: mockPRChecks,
      checksPolling: false,
      activeTab: 'conversation',
      viewedFiles: new Set<string>(),
      commits: mockPRCommits,
      selectedCommitHash: null,
      commitDiff: null,
      viewMode: 'single',
      reviewThreads: mockPRReviewThreads,
      commentFilter: 'all',
    })
  }

  // Editor store
  if (options.editorMode) {
    useEditorStore.setState({
      editorMode: true,
      openFiles: [
        {
          path: '/Users/dev/repos/CodeCrucible/src/renderer/App.tsx',
          name: 'App.tsx',
          content: mockFileContent,
          savedContent: mockFileContent,
          language: 'typescript-jsx',
        },
      ],
      activeFilePath: '/Users/dev/repos/CodeCrucible/src/renderer/App.tsx',
      currentBranch: 'session/add-pr-review',
    })
  } else {
    useEditorStore.setState({ editorMode: false })
  }

  // Usage store
  useUsageStore.setState({
    sessionUsages: { 'sess-1': mockSessionUsage },
    stats: mockUsageStats,
    subscription: mockSubscription,
    statsLoading: false,
  })

  // Notes store
  useNotesStore.setState({
    notes: mockNotes,
    selectedNoteId: null,
  })

  // Button store
  useButtonStore.setState({
    buttons: mockButtons,
    groups: mockButtonGroups,
    runningButtons: {},
  })

  // Settings store
  if (options.settingsOpen) {
    useSettingsStore.setState({ isOpen: true })
  } else {
    useSettingsStore.setState({ isOpen: false })
  }

  // Workspace layout store — pre-populate saved layouts so SessionWorkspace
  // restores the correct active tab on mount
  const activeTab = options.activeWorkspaceTab ?? 'agent'
  const tabs: WorkspaceTab[] = options.workspaceTabs ?? (
    options.activePRNumber
      ? ['pr', 'review']
      : ['agent', 'git', 'pr', 'review']
  )

  const savedLayout = [{
    id: 'col-preset',
    tabs,
    activeTab: (tabs.includes(activeTab as WorkspaceTab) ? activeTab : tabs[0]) as WorkspaceTab,
    flex: 1,
  }]

  // Save layout under the context ID that SessionWorkspace will look for
  const contextId = options.activePRNumber
    ? `pr-${options.activePRNumber}`
    : sessionId

  // Also pre-save the Code workspace layout so EditorWorkspace restores the
  // chosen active tab (e.g. the Worktree tab) when editorMode is enabled.
  const editorContextId = `code-editor:${projectId}`
  const editorActiveTab = options.editorActiveTab ?? 'code'
  const editorLayout = [{
    id: 'col-editor-preset',
    tabs: ['code', 'git'] as WorkspaceTab[],
    activeTab: editorActiveTab as WorkspaceTab,
    flex: 1,
  }]

  useWorkspaceLayoutStore.setState({
    columns: options.editorMode ? editorLayout : savedLayout,
    savedLayouts: {
      [contextId]: savedLayout,
      [editorContextId]: editorLayout,
    },
  })
}

export function resetStores() {
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] })
  useSessionStore.setState({ sessions: [], staleSessions: [], currentProjectId: null, activeSessionId: null, activePRNumber: null, activeWorkspaceTab: 'agent' })
  useGitStore.setState({ commits: [], changedFiles: [], workingFiles: [], selectedCommitHash: null, selectedFilePath: null, filePatch: null, loading: false })
  useNotificationStore.setState({ contextStatuses: new Map(), sessionProjectMap: new Map() })
  usePRStore.setState({
    pullRequests: [],
    seenPRs: [],
    loading: false,
    hasLoaded: false,
    prCache: {},
    seenCache: {},
    collaboratorsCache: {},
    currentRepoPath: null,
    currentProjectId: null,
    currentUser: null,
  })
  usePRViewStore.setState({ byRepo: {} })
  usePRReviewStore.setState({ prNumber: null, files: [], selectedFilePath: null, fullDiff: null, comments: [], detail: null, conversationComments: [], checks: [], commits: [] })
  useEditorStore.setState({ editorMode: false, openFiles: [], activeFilePath: null })
  useUsageStore.setState({ sessionUsages: {}, stats: null, subscription: null })
  useNotesStore.setState({ notes: [], selectedNoteId: null })
  useSettingsStore.setState({ isOpen: false })
  useButtonStore.setState({ buttons: [], groups: [], runningButtons: {} })
  useWorkspaceLayoutStore.setState({ columns: [], savedLayouts: {} })
}

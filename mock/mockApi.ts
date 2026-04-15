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
  mockPRReviewThreads,
  mockPRComments,
  mockPRCommits,
  mockSessionUsage,
  mockUsageStats,
  mockSubscription,
  mockNotes,
  mockFileTree,
  mockFileTreeSrc,
  mockFileTreeRenderer,
  mockFileContent,
  mockTerminalOutput,
  mockButtons,
  mockButtonGroups,
} from './mockData'

// Collect terminal.onData callbacks so we can push fake output
const terminalDataCallbacks: Array<(terminalId: string, data: string) => void> = []
const terminalExitCallbacks: Array<(terminalId: string, exitCode: number) => void> = []
let terminalCounter = 0

function noop() { return () => {} }

// Build the mock window.api matching src/preload/index.ts
export const mockApi = {
  git: {
    status: async () => ({ current: 'session/add-pr-review', tracking: 'origin/session/add-pr-review', files: [] }),
    log: async () => mockCommits,
    diff: async () => mockFileDiffs,
    fileDiff: async () => mockUnifiedDiff,
    checkout: async () => ({ stashed: false }),
    restoreWorktree: async () => {},
    workingFiles: async () => mockWorkingFiles,
    workingFileDiff: async () => mockUnifiedDiff,
    commitStatuses: async () => ({ unpushedHashes: ['a1b2c3d', 'e4f5g6h'], newBranchHashes: [] }),
    push: async () => {},
    openPR: async () => {},
    listBranches: async () => ['main', 'session/add-pr-review', 'session/fix-terminal-resize', 'session/usage-tracking', 'session/editor-view'],
    defaultBranch: async () => 'main',
    mergeCheck: async () => ({ hasConflicts: false }),
    merge: async () => {},
    isMerged: async () => false,
  },

  worktree: {
    create: async () => ({ path: '/mock/worktree', branch: 'session/new' }),
    list: async () => [],
    remove: async () => {},
    createFromBranch: async () => ({ path: '/mock/worktree', branch: 'session/new' }),
  },

  terminal: {
    spawn: async (sessionId: string) => {
      const terminalId = `mock-term-${++terminalCounter}`
      // Push fake output after a short delay
      setTimeout(() => {
        for (let i = 0; i < mockTerminalOutput.length; i++) {
          setTimeout(() => {
            for (const cb of terminalDataCallbacks) {
              cb(terminalId, mockTerminalOutput[i])
            }
          }, i * 80) // stagger output for realism
        }
      }, 300)
      return terminalId
    },
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onData: (callback: (terminalId: string, data: string) => void) => {
      terminalDataCallbacks.push(callback)
      return () => {
        const idx = terminalDataCallbacks.indexOf(callback)
        if (idx >= 0) terminalDataCallbacks.splice(idx, 1)
      }
    },
    onExit: (callback: (terminalId: string, exitCode: number) => void) => {
      terminalExitCallbacks.push(callback)
      return () => {
        const idx = terminalExitCallbacks.indexOf(callback)
        if (idx >= 0) terminalExitCallbacks.splice(idx, 1)
      }
    },
  },

  notification: {
    show: async () => {},
    getPort: async () => null,
    triggerForSession: async () => {},
    onSessionStatus: () => noop(),
    registerSession: async () => {},
    unregisterSession: async () => {},
    setBadge: async () => {},
  },

  project: {
    list: async () => mockProjects,
    add: async () => mockProjects,
    remove: async () => mockProjects,
    reorder: async () => mockProjects,
    selectFolder: async () => null,
    update: async () => mockProjects,
  },

  account: {
    list: async () => mockAccounts,
    save: async () => {},
    authStatus: async () => ({ email: 'dev@example.com', orgName: null }),
    authSpawn: async () => 'mock-auth-id',
    authKill: async () => {},
    onAuthData: () => noop(),
    onAuthExit: () => noop(),
  },

  github: {
    listPRs: async () => mockPullRequests,
    getSeenPRs: async () => [],
    markPRSeen: async () => {},
    getDiff: async () => mockUnifiedDiff,
    getFilePatch: async () => mockUnifiedDiff,
    getFiles: async () => mockPRFiles,
    getComments: async () => mockPRComments,
    createComment: async () => mockPRComments[0],
    submitReview: async () => {},
    getMergeability: async () => ({ mergeable: 'MERGEABLE' as const }),
    merge: async () => {},
    getDetail: async () => mockPRDetail,
    getConversationComments: async () => mockPRConversationComments,
    getChecks: async () => mockPRChecks,
    getViewedFiles: async () => [],
    setViewedFiles: async () => {},
    getCommits: async () => mockPRCommits,
    getCommitDiff: async () => mockUnifiedDiff,
    getReviewThreads: async () => mockPRReviewThreads,
  },

  session: {
    list: async (projectId: string) => [
      ...(mockSessions[projectId] ?? []),
      ...(mockStaleSessions[projectId] ?? []),
    ],
    save: async () => {},
  },

  notes: {
    list: async () => mockNotes,
    save: async () => {},
    delete: async () => {},
  },

  usage: {
    getSession: async () => mockSessionUsage,
    getStats: async () => mockUsageStats,
    getSubscription: async () => mockSubscription,
    onSessionUpdate: () => noop(),
  },

  file: {
    listDir: async (dirPath: string) => {
      if (dirPath.endsWith('/src')) return mockFileTreeSrc
      if (dirPath.endsWith('/renderer')) return mockFileTreeRenderer
      return mockFileTree
    },
    read: async () => mockFileContent,
    write: async () => {},
    create: async () => {},
    stat: async () => ({ size: 1234, exists: true }),
    move: async () => {},
    watch: async () => {},
    unwatch: async () => {},
    onChanged: () => noop(),
  },

  permissions: {
    get: async () => ({
      allow: ['Read', 'Write', 'Edit', 'Bash(npm run dev)', 'Bash(npm run build)'],
      deny: ['Bash(rm -rf *)'],
    }),
    update: async () => {},
    onChanged: () => noop(),
  },

  button: {
    list: async () => mockButtons,
    save: async () => {},
    groupList: async () => mockButtonGroups,
    groupSave: async () => {},
    execute: async () => `mock-btn-term-${++terminalCounter}`,
  },

  config: {
    list: async () => [],
    getContent: async () => null,
    setTracking: async () => {},
    createCommand: async () => ({ id: 'mock', name: 'mock', type: 'command', path: '/mock', tracking: 'none' }),
    createClaudeMd: async () => ({ id: 'mock', name: 'mock', type: 'claude-md', path: '/mock', tracking: 'none' }),
    delete: async () => {},
    updateContent: async () => {},
    onChanged: () => noop(),
  },

  update: {
    onStatus: () => noop(),
    onLog: () => noop(),
    apply: async () => {},
  },
}

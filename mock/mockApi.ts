import {
  mockProjects,
  mockAccounts,
  mockSessions,
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
  mockStartupPrompts,
  mockReviewLoopSettings,
  mockReviewLoopRunning,
} from './mockData'

// Collect terminal.onData callbacks so we can push fake output
const terminalDataCallbacks: Array<(terminalId: string, data: string) => void> = []
const terminalExitCallbacks: Array<(terminalId: string, exitCode: number) => void> = []
let terminalCounter = 0

function noop() { return () => {} }

// Scheduler mock state. Mirrors src/main/services/scheduler.service.ts but
// simpler: stores in-memory, broadcasts via callbacks, fires via setTimeout.
// Exposed on window for Playwright assertions.
type QueuedSession = {
  id: string
  projectId: string
  name: string
  baseBranch?: string
  startupPrompt: string
  scheduledFor: number
  createdAt: string
}
type QueuedMessage = {
  id: string
  sessionId: string
  message: string
  scheduledFor: number
  createdAt: string
  reason: 'usage-reset' | 'manual'
}
const queuedSessions: QueuedSession[] = []
const queuedMessages: QueuedMessage[] = []
const sessionsUpdateListeners: Array<(list: QueuedSession[]) => void> = []
const messagesUpdateListeners: Array<(list: QueuedMessage[]) => void> = []
const fireSessionListeners: Array<(item: QueuedSession) => void> = []
const fireMessageListeners: Array<(item: QueuedMessage) => void> = []
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()
const messageTimers = new Map<string, ReturnType<typeof setTimeout>>()

function broadcastQueuedSessions() {
  for (const cb of sessionsUpdateListeners) cb([...queuedSessions])
}
function broadcastQueuedMessages() {
  for (const cb of messagesUpdateListeners) cb([...queuedMessages])
}
function scheduleSessionFire(item: QueuedSession) {
  const t = sessionTimers.get(item.id)
  if (t) clearTimeout(t)
  const delay = Math.max(0, item.scheduledFor - Date.now())
  sessionTimers.set(
    item.id,
    setTimeout(() => {
      const idx = queuedSessions.findIndex((s) => s.id === item.id)
      if (idx < 0) return
      const [fired] = queuedSessions.splice(idx, 1)
      sessionTimers.delete(item.id)
      broadcastQueuedSessions()
      for (const cb of fireSessionListeners) cb(fired)
    }, delay)
  )
}
function scheduleMessageFire(item: QueuedMessage) {
  const t = messageTimers.get(item.id)
  if (t) clearTimeout(t)
  const delay = Math.max(0, item.scheduledFor - Date.now())
  messageTimers.set(
    item.id,
    setTimeout(() => {
      const idx = queuedMessages.findIndex((m) => m.id === item.id)
      if (idx < 0) return
      const [fired] = queuedMessages.splice(idx, 1)
      messageTimers.delete(item.id)
      broadcastQueuedMessages()
      for (const cb of fireMessageListeners) cb(fired)
    }, delay)
  )
}

// Surface terminal write calls to Playwright for assertions on prompt
// injection. Keys by terminalId; arrays append in arrival order.
const terminalWrites: Array<{ terminalId: string; data: string }> = []
;(window as any).__terminalWrites = terminalWrites
;(window as any).__queuedSessions = queuedSessions
;(window as any).__queuedMessages = queuedMessages

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
    write: async (terminalId: string, data: string) => {
      terminalWrites.push({ terminalId, data })
    },
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
    killSession: async () => {},
    getRecoveryList: async () => [],
  },

  notification: {
    show: async () => {},
    getPort: async () => null,
    triggerForSession: async () => {},
    onSessionStatus: () => noop(),
    onFocusRequest: () => noop(),
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
    getCurrentUser: async () => 'alice',
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
    list: async (projectId: string) => mockSessions[projectId] ?? [],
    save: async () => {},
    saveContext: async () => {},
    getContext: async () => null,
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
    onLimitReached: () => noop(),
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
    execute: async () => {
      const terminalId = `mock-btn-term-${++terminalCounter}`
      // Mirror the real terminal.spawn behaviour — emit fake output so the
      // renderer's `>`-detection-then-write helper sees a prompt and fires.
      // Used by both custom buttons and the queued-session fire flow.
      setTimeout(() => {
        for (let i = 0; i < mockTerminalOutput.length; i++) {
          setTimeout(() => {
            for (const cb of terminalDataCallbacks) {
              cb(terminalId, mockTerminalOutput[i])
            }
          }, i * 80)
        }
      }, 300)
      return terminalId
    },
  },

  startupPrompt: {
    list: async (projectId: string) => mockStartupPrompts[projectId] ?? [],
    save: async () => {},
  },

  reviewLoop: {
    getSettings: async () => mockReviewLoopSettings,
    setSettings: async () => {},
    start: async () => {},
    cancel: async () => {},
    /**
     * Stories can override the returned state by setting
     * `(window as any).__mockReviewLoopState = state` before mount.
     * Falls back to the running snapshot.
     */
    getState: async () => {
      const override = (globalThis as any).__mockReviewLoopState
      return override ?? mockReviewLoopRunning
    },
    onStateUpdate: () => noop(),
  },

  claudeWeb: {
    listSessions: async () => [
      {
        branchName: 'claude/zen-mendeleev',
        headSha: 'aaa1111',
        lastCommitDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        authorName: 'Matt Moran',
      },
      {
        branchName: 'claude/eager-darwin',
        headSha: 'bbb2222',
        lastCommitDate: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        authorName: 'Matt Moran',
      },
      {
        branchName: 'claude/wise-curie',
        headSha: 'ccc3333',
        lastCommitDate: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
        authorName: 'Matt Moran',
      },
    ],
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
    getBuiltCommit: async () => 'mock-commit-sha',
  },

  scheduler: {
    listQueuedSessions: async () => [...queuedSessions],
    addQueuedSession: async (item: QueuedSession) => {
      const idx = queuedSessions.findIndex((s) => s.id === item.id)
      if (idx >= 0) queuedSessions.splice(idx, 1)
      queuedSessions.push(item)
      broadcastQueuedSessions()
      scheduleSessionFire(item)
      return [...queuedSessions]
    },
    cancelQueuedSession: async (id: string) => {
      const idx = queuedSessions.findIndex((s) => s.id === id)
      if (idx >= 0) queuedSessions.splice(idx, 1)
      const t = sessionTimers.get(id)
      if (t) {
        clearTimeout(t)
        sessionTimers.delete(id)
      }
      broadcastQueuedSessions()
      return [...queuedSessions]
    },
    rescheduleQueuedSession: async (id: string, scheduledFor: number) => {
      const item = queuedSessions.find((s) => s.id === id)
      if (item) {
        item.scheduledFor = scheduledFor
        scheduleSessionFire(item)
        broadcastQueuedSessions()
      }
      return [...queuedSessions]
    },
    fireQueuedSessionNow: async (id: string) => {
      const item = queuedSessions.find((s) => s.id === id)
      if (!item) return
      const t = sessionTimers.get(id)
      if (t) clearTimeout(t)
      sessionTimers.delete(id)
      const idx = queuedSessions.findIndex((s) => s.id === id)
      queuedSessions.splice(idx, 1)
      broadcastQueuedSessions()
      for (const cb of fireSessionListeners) cb(item)
    },
    onQueuedSessionsUpdate: (cb: (list: QueuedSession[]) => void) => {
      sessionsUpdateListeners.push(cb)
      return () => {
        const idx = sessionsUpdateListeners.indexOf(cb)
        if (idx >= 0) sessionsUpdateListeners.splice(idx, 1)
      }
    },
    onFireQueuedSession: (cb: (item: QueuedSession) => void) => {
      fireSessionListeners.push(cb)
      return () => {
        const idx = fireSessionListeners.indexOf(cb)
        if (idx >= 0) fireSessionListeners.splice(idx, 1)
      }
    },

    listQueuedMessages: async () => [...queuedMessages],
    addQueuedMessage: async (item: QueuedMessage) => {
      const filtered = queuedMessages.filter(
        (m) => m.sessionId !== item.sessionId && m.id !== item.id
      )
      queuedMessages.length = 0
      queuedMessages.push(...filtered, item)
      broadcastQueuedMessages()
      scheduleMessageFire(item)
      return [...queuedMessages]
    },
    cancelQueuedMessage: async (id: string) => {
      const idx = queuedMessages.findIndex((m) => m.id === id)
      if (idx >= 0) queuedMessages.splice(idx, 1)
      const t = messageTimers.get(id)
      if (t) {
        clearTimeout(t)
        messageTimers.delete(id)
      }
      broadcastQueuedMessages()
      return [...queuedMessages]
    },
    onQueuedMessagesUpdate: (cb: (list: QueuedMessage[]) => void) => {
      messagesUpdateListeners.push(cb)
      return () => {
        const idx = messagesUpdateListeners.indexOf(cb)
        if (idx >= 0) messagesUpdateListeners.splice(idx, 1)
      }
    },
    onFireQueuedMessage: (cb: (item: QueuedMessage) => void) => {
      fireMessageListeners.push(cb)
      return () => {
        const idx = fireMessageListeners.indexOf(cb)
        if (idx >= 0) fireMessageListeners.splice(idx, 1)
      }
    },
    spawnAgentWithPrompt: async (
      sessionId: string,
      _cwd: string,
      prompt: string,
    ): Promise<string> => {
      const terminalId = `mock-sched-term-${++terminalCounter}-${sessionId}`
      // Record the prompt as the first "write" so e2e tests can assert
      // injection happened — even though the heredoc-pipe path doesn't
      // technically go through window.api.terminal.write.
      terminalWrites.push({ terminalId, data: prompt + '\r' })
      // Emit a friendly bit of fake terminal output so xterm has something
      // to render (and any prompt-detection-style assertions still pass).
      setTimeout(() => {
        for (let i = 0; i < mockTerminalOutput.length; i++) {
          setTimeout(() => {
            for (const cb of terminalDataCallbacks) {
              cb(terminalId, mockTerminalOutput[i])
            }
          }, i * 80)
        }
      }, 300)
      return terminalId
    },
  },

  notion: (() => {
    type Cfg = Record<string, unknown>
    const configByProject: Record<string, Cfg> = {}
    const fireListeners: Array<(payload: unknown) => void> = []
    const writeBackCalls: Array<{
      projectId: string
      page: unknown
      branch: string
      sessionId: string
    }> = []
    ;(globalThis as any).__notionWriteBackCalls = writeBackCalls
    ;(globalThis as any).__notionFireTask = (payload: unknown) => {
      for (const cb of fireListeners) cb(payload)
    }
    return {
      loadConfig: async (projectId: string) => configByProject[projectId] ?? null,
      saveConfig: async (projectId: string, config: Cfg) => {
        configByProject[projectId] = config
      },
      testConnection: async (token: string, dbId: string) => {
        if (!token || !dbId) return { ok: false, error: 'Missing token or database id' }
        if (token === 'BAD') return { ok: false, error: 'Unauthorized' }
        return { ok: true, taskCount: 3 }
      },
      getDatabaseSchema: async () => ({
        id: 'mock-db',
        title: 'Crucible Tasks',
        titlePropertyName: 'Task',
        properties: [
          { name: 'Task', type: 'title' },
          {
            name: 'Status',
            type: 'status',
            options: [
              { id: 'ready', name: 'Ready' },
              { id: 'in_progress', name: 'In Progress' },
              { id: 'done', name: 'Done' },
            ],
          },
          { name: 'Crucible Branch', type: 'url' },
        ],
      }),
      applyWriteBack: async (
        projectId: string,
        page: unknown,
        branch: string,
        sessionId: string,
      ) => {
        writeBackCalls.push({ projectId, page, branch, sessionId })
      },
      clearPickedUp: async () => {},
      getConfigPath: async () => '/mock/userData/dev/notion-integration.json',
      onFireTask: (cb: (payload: unknown) => void) => {
        fireListeners.push(cb)
        return () => {
          const idx = fireListeners.indexOf(cb)
          if (idx >= 0) fireListeners.splice(idx, 1)
        }
      },
    }
  })(),
}

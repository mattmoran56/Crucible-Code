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
import { demoVisualAgentSnapshot } from './visualAgentDemo'
import type {
  VisualAgentEvent,
  VisualAgentFrame,
  VisualAgentSnapshot,
  VisualAgentStartOptions,
} from '../src/shared/visual-agent'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../src/shared/visual-agent'

// Collect terminal.onData callbacks so we can push fake output
const terminalDataCallbacks: Array<(terminalId: string, data: string) => void> = []

/** A fake PTY that prints `lines` and returns its terminal id. */
function mockPty(lines: string[]): string {
  const terminalId = `mock-term-${++terminalCounter}`
  setTimeout(() => {
    lines.forEach((line, i) =>
      setTimeout(() => {
        for (const cb of terminalDataCallbacks) cb(terminalId, line)
      }, i * 80)
    )
  }, 200)
  return terminalId
}
const terminalExitCallbacks: Array<(terminalId: string, exitCode: number) => void> = []
let terminalCounter = 0
const cloudCreateCallbacks: Array<(state: any) => void> = []
const cloudTeleportCallbacks: Array<(state: any) => void> = []

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
// Visual Agent mock: an in-memory snapshot per agent plus frame listeners, so
// the chat UI can be driven in Storybook / e2e without a real claude process.
const visualAgentListeners = new Set<(agentId: string, frame: VisualAgentFrame) => void>()
const visualAgentSnapshots = new Map<string, VisualAgentSnapshot>()
function vaEmit(agentId: string, frame: VisualAgentFrame) {
  const snap = visualAgentSnapshots.get(agentId)
  if (snap) {
    if (frame.t === 'event') snap.events.push(frame.event)
    else if (frame.t === 'state') {
      snap.state = frame.state
      snap.turnStartedAt = frame.turnStartedAt
    } else if (frame.t === 'session') snap.model = frame.model
    else if (frame.t === 'forks') snap.forks = frame.forks
    else if (frame.t === 'partial') snap.partial = frame.text ? { messageId: frame.messageId, threadId: frame.threadId, text: frame.text } : null
  }
  for (const cb of visualAgentListeners) cb(agentId, frame)
}
function vaEvent(agentId: string, body: Record<string, unknown>, threadId = 'main'): VisualAgentEvent {
  const snap = visualAgentSnapshots.get(agentId)
  const seq = snap ? snap.events.length : 0
  return { uuid: `mock-${agentId}-${seq}-${Math.random().toString(36).slice(2, 8)}`, seq, threadId, at: new Date().toISOString(), ...body } as VisualAgentEvent
}
// Surface visual-agent starts and sent messages to Playwright, so e2e tests can
// assert a startup prompt reached the Agent tab.
const visualAgentStarts: VisualAgentStartOptions[] = []
const visualAgentSends: Array<{ agentId: string; text: string }> = []
;(window as any).__visualAgentStarts = visualAgentStarts
;(window as any).__visualAgentSends = visualAgentSends

/** A user turn plus a streamed mock reply. */
function vaReply(agentId: string, text: string) {
  const turnStartedAt = new Date().toISOString()
  vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'text', role: 'user', text }) })
  vaEmit(agentId, { t: 'state', state: 'running', turnStartedAt })
  const reply = `This is a mock reply to: **${text.slice(0, 80)}**. In the real app Claude Code would answer here, streaming token by token.`
  vaStream(agentId, reply, () => {
    vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'text', role: 'assistant', text: reply }) })
    vaEmit(agentId, {
      t: 'event',
      event: vaEvent(agentId, { kind: 'result', ok: true, costUsd: 0.0123, durationMs: 1800, usage: { input: 12, output: 48, cacheRead: 9000, cacheWrite: 0 }, text: reply }),
    })
    vaEmit(agentId, { t: 'state', state: 'idle', turnStartedAt: null })
  })
}

function vaStream(agentId: string, text: string, done: () => void) {
  const messageId = `msg_mock_${Date.now()}`
  const words = text.split(/(?<= )/)
  let acc = ''
  words.forEach((w, i) => {
    setTimeout(() => {
      acc += w
      vaEmit(agentId, { t: 'partial', messageId, threadId: 'main', text: acc })
      if (i === words.length - 1) {
        vaEmit(agentId, { t: 'partial', messageId, threadId: 'main', text: '' })
        done()
      }
    }, 300 + i * 40)
  })
}

export const mockApi = {
  /** Story-only helpers, reached through window.api so stories need no mock imports. */
  __mock: {
    demoVisualAgentSnapshot,
    /** A fake PTY that prints `lines`; returns its terminal id. */
    pty: mockPty,
  },

  git: {
    status: async () => ({ current: 'session/add-pr-review', tracking: 'origin/session/add-pr-review', files: [] }),
    log: async () => mockCommits,
    diff: async () => mockFileDiffs,
    fileDiff: async () => mockUnifiedDiff,
    checkout: async () => ({ stashed: false }),
    restoreWorktree: async () => {},
    workingFiles: async () => mockWorkingFiles,
    workingFileDiff: async () => mockUnifiedDiff,
    showFile: async () => mockFileContent,
    showFileBase64: async () => btoa(unescape(encodeURIComponent(mockFileContent))),
    commitStatuses: async () => ({ unpushedHashes: ['a1b2c3d', 'e4f5g6h'], newBranchHashes: [] }),
    push: async () => {},
    openPR: async () => {},
    listBranches: async () => ['main', 'session/add-pr-review', 'session/fix-terminal-resize', 'session/usage-tracking', 'session/editor-view'],
    defaultBranch: async () => 'main',
    mergeCheck: async () => ({ hasConflicts: false }),
    merge: async () => {},
    compareFiles: async () => mockWorkingFiles,
    compareDiff: async () => mockUnifiedDiff,
  },

  worktree: {
    create: async (_repoPath: string, sessionName: string, _baseBranch?: string, branchName?: string) => ({
      path: '/mock/worktree',
      branch: branchName || `session/${sessionName}`,
    }),
    list: async () => [],
    remove: async () => ({ removed: [], failed: [] }),
    createFromBranch: async () => ({ path: '/mock/worktree', branch: 'session/new' }),
    currentBranch: async () => 'session/new',
    deleteLocalBranch: async () => {},
    deleteRemoteBranch: async () => {},
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
    getFileBlob: async () => mockFileContent,
  },

  session: {
    /**
     * Stories can pin a project's session list with
     * `(window as any).__mockSessions = { [projectId]: sessions }` before mount.
     */
    list: async (projectId: string) =>
      (globalThis as any).__mockSessions?.[projectId] ?? mockSessions[projectId] ?? [],
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

  sandboxer: {
    checkConfig: async (repoPath: string) => ({
      path: `${repoPath}/sandboxer.yaml`,
      exists: true,
      gitState: 'ignored' as const,
      cliVersion: '0.1.0',
    }),
    prepare: async (repoPath: string) => ({ copied: true, source: `${repoPath}/sandboxer.yaml` }),
    status: async (worktreePath: string) => [
      {
        project: 'acme',
        slug: 'new-feature',
        branch: 'session/new-feature',
        worktree: worktreePath,
        state: 'running',
        container: 'sandboxer-acme-new-feature',
        ttl: '43200',
        urls: {
          app: 'https://new-feature--app--acme.sbx.localhost',
          api: 'https://new-feature--api--acme.sbx.localhost',
        },
      },
    ],
    stop: async () => {},
    start: async () => {},
    down: async () => ({ removed: ['acme/new-feature'], failed: [] }),
    openUrl: async () => {},
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

  visualAgent: {
    start: async (opts: VisualAgentStartOptions): Promise<VisualAgentSnapshot> => {
      visualAgentStarts.push(opts)
      let snap = visualAgentSnapshots.get(opts.agentId)
      if (!snap) {
        // A fresh agent idles on its empty state (deterministic for visual
        // baselines); stories that want the demo conversation seed it.
        snap = {
          agentId: opts.agentId,
          claudeSessionId: `mock-claude-${opts.agentId}`,
          model: opts.model ?? DEFAULT_VISUAL_AGENT_MODEL,
          state: 'idle',
          events: [],
          partial: null,
          usage: null,
          forks: [],
          turnStartedAt: null,
        }
        visualAgentSnapshots.set(opts.agentId, snap)
        const prompt = opts.initialPrompt
        if (prompt) setTimeout(() => vaReply(opts.agentId, prompt), 50)
      }
      return { ...snap, events: [...snap.events], forks: [...snap.forks] }
    },
    send: async (agentId: string, text: string) => {
      visualAgentSends.push({ agentId, text })
      vaReply(agentId, text)
    },
    interrupt: async (agentId: string) => {
      vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'note', source: 'interrupt', label: 'Interrupted', text: '[Request interrupted by user]' }) })
      vaEmit(agentId, { t: 'state', state: 'idle', turnStartedAt: null })
    },
    stop: async (agentId: string) => {
      vaEmit(agentId, { t: 'state', state: 'done', turnStartedAt: null })
    },
    answer: async (agentId: string, requestId: string, decision: 'allow' | 'always' | 'deny') => {
      vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'ask-result', id: requestId, decision }) })
      const snap = visualAgentSnapshots.get(agentId)
      const ask = snap?.events.find((e) => e.kind === 'ask' && e.id === requestId)
      const toolId = ask && ask.kind === 'ask' ? ask.toolUseId : ''
      vaEmit(agentId, { t: 'state', state: 'running', turnStartedAt: new Date().toISOString() })
      setTimeout(() => {
        if (toolId) {
          vaEmit(agentId, {
            t: 'event',
            event: vaEvent(agentId, decision === 'deny'
              ? { kind: 'tool-result', id: toolId, ok: false, text: 'Denied from CodeCrucible.' }
              : { kind: 'tool-result', id: toolId, ok: true, text: 'To github.com:acme/acme-web.git\n * [new branch]  fix/safari-signin -> fix/safari-signin' }),
          })
        }
        const text = decision === 'deny' ? "OK, I won't push. The fix is committed locally." : 'Pushed `fix/safari-signin` to origin.'
        vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'text', role: 'assistant', text }) })
        vaEmit(agentId, { t: 'event', event: vaEvent(agentId, { kind: 'result', ok: true, costUsd: 0.02, durationMs: 2100, usage: null, text }) })
        vaEmit(agentId, { t: 'state', state: 'idle', turnStartedAt: null })
      }, 600)
    },
    setModel: async (agentId: string, model: string) => {
      const snap = visualAgentSnapshots.get(agentId)
      vaEmit(agentId, { t: 'session', claudeSessionId: snap?.claudeSessionId ?? '', model })
    },
    fork: async (agentId: string, question: string) => {
      const snap = visualAgentSnapshots.get(agentId)
      const forkId = `fork-mock-${Date.now()}`
      const fork = { id: forkId, question, startedAt: new Date().toISOString(), afterSeq: snap?.events.length ?? 0, state: 'running' as const, events: [] as VisualAgentEvent[] }
      const forks = () => visualAgentSnapshots.get(agentId)?.forks ?? []
      vaEmit(agentId, { t: 'forks', forks: [...forks(), fork] })
      setTimeout(() => {
        const answer: VisualAgentEvent = { uuid: `${forkId}-0`, seq: 0, threadId: 'main', at: new Date().toISOString(), kind: 'text', role: 'assistant', text: `(mock side answer) Good question — "${question.slice(0, 60)}". From the conversation so far, I'd check the relevant file before changing anything.` }
        const result: VisualAgentEvent = { uuid: `${forkId}-1`, seq: 1, threadId: 'main', at: new Date().toISOString(), kind: 'result', ok: true, costUsd: 0.004, durationMs: 1200, usage: null, text: '' }
        vaEmit(agentId, { t: 'fork-event', forkId, event: answer })
        vaEmit(agentId, { t: 'fork-event', forkId, event: result })
        vaEmit(agentId, { t: 'forks', forks: forks().map((f) => (f.id === forkId ? { ...f, state: 'done' as const, events: [answer, result] } : f)) })
      }, 900)
      return { forkId }
    },
    forkStop: async (agentId: string, forkId: string) => {
      const forks = visualAgentSnapshots.get(agentId)?.forks ?? []
      vaEmit(agentId, { t: 'forks', forks: forks.map((f) => (f.id === forkId && f.state === 'running' ? { ...f, state: 'done' as const } : f)) })
    },
    getState: async (agentId: string): Promise<VisualAgentSnapshot | null> => {
      const snap = visualAgentSnapshots.get(agentId)
      return snap ? { ...snap, events: [...snap.events], forks: [...snap.forks] } : null
    },
    onFrame: (cb: (agentId: string, frame: VisualAgentFrame) => void) => {
      visualAgentListeners.add(cb)
      return () => {
        visualAgentListeners.delete(cb)
      }
    },
  },

  // Cloud sessions: nothing leaves the machine. The teleport "PTY" just
  // prints a canned transcript so stories and the mock app show the flow.
  cloudSession: {
    // Interactive create: a PTY that shows the CLI's setup checklist, then the
    // session URL; the 'created' event follows, like the main process's watcher.
    start: async (opts: { sessionId: string; projectId: string; branch: string; task: string }) => {
      const sessionId = 'session_01MockCloudSession'
      const url = `https://claude.ai/code/${sessionId}`
      const terminalId = mockPty([
        `\x1b[90m$ claude --cloud '<task>' --on-branch ${opts.branch}\x1b[0m\r\n`,
        'Setting up remote session…\r\n',
        '  \x1b[32m✓\x1b[0m Checked this checkout\r\n',
        '  \x1b[32m✓\x1b[0m Created cloud session\r\n',
        `Cloud session active · code here or at ${url}?from=cli&m=0\r\n`,
      ])
      const base = { sessionId: opts.sessionId, projectId: opts.projectId, terminalId, attached: true }
      setTimeout(() => {
        for (const cb of cloudCreateCallbacks) cb({ ...base, status: 'created', result: { sessionId, url, branch: opts.branch } })
      }, 900)
      return { ...base, status: 'running' as const }
    },
    createState: async () => null,
    onCreateEvent: (cb: (state: any) => void) => {
      cloudCreateCallbacks.push(cb)
      return () => {
        const i = cloudCreateCallbacks.indexOf(cb)
        if (i >= 0) cloudCreateCallbacks.splice(i, 1)
      }
    },
    send: async (opts: { cloudSessionId: string }) => ({ sessionId: opts.cloudSessionId, url: `https://claude.ai/code/${opts.cloudSessionId}` }),
    // Teleport: the CLI's steps in a PTY; the run reports them, then 'done'
    // with a local session id (the Agent tab then resumes it visually).
    teleport: async (opts: { sessionId: string; projectId?: string; cloudSessionId: string }) => {
      const terminalId = mockPty([
        `\x1b[90m$ claude --teleport ${opts.cloudSessionId}\x1b[0m\r\n`,
        '\x1b[32m✓\x1b[0m Validating session\r\n',
        '\x1b[32m✓\x1b[0m Fetching session logs\r\n',
        '\x1b[32m✓\x1b[0m Getting branch info\r\n',
        '\x1b[32m✓\x1b[0m Checking out branch\r\n',
        '⎿ Session resumed\r\n',
      ])
      const base = {
        sessionId: opts.sessionId,
        projectId: opts.projectId,
        terminalId,
        startedAt: new Date().toISOString(),
      }
      const steps = ['Validating session', 'Fetching session logs', 'Getting branch info', 'Checking out branch', 'Session resumed']
      const emit = (state: any) => {
        for (const cb of cloudTeleportCallbacks) cb(state)
      }
      steps.forEach((_, i) =>
        setTimeout(() => emit({ ...base, status: 'running', steps: steps.slice(0, i + 1) }), 400 * (i + 1))
      )
      setTimeout(() => emit({ ...base, status: 'finishing', steps }), 400 * (steps.length + 1))
      setTimeout(
        () => emit({ ...base, status: 'done', steps, claudeSessionId: '00000000-0000-4000-8000-00000000c10d' }),
        400 * (steps.length + 2)
      )
      return { ok: true as const, terminalId, state: { ...base, status: 'running' as const, steps: [] } }
    },
    teleportState: async () => null,
    finishTeleport: async () => null,
    onTeleportEvent: (cb: (state: any) => void) => {
      cloudTeleportCallbacks.push(cb)
      return () => {
        const i = cloudTeleportCallbacks.indexOf(cb)
        if (i >= 0) cloudTeleportCallbacks.splice(i, 1)
      }
    },
    discoverLocal: async () => null,
    openUrl: async () => {},
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

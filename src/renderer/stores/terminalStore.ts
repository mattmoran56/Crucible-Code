import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'
import { useProjectStore } from './projectStore'
import { destroyTerminal } from '../components/terminal/useTerminal'

type TerminalMode = 'shell' | 'claude' | 'review'

interface TerminalInstance {
  terminalId: string
  sessionId: string
  sessionName: string
  mode: TerminalMode
}

interface TerminalState {
  // Keyed by `${sessionId}:${mode}` so each session can have both a claude and shell terminal
  // Dynamic terminals use `${tabId}:${sessionId}` keys
  terminals: Record<string, TerminalInstance>
  spawnTerminal: (sessionId: string, sessionName: string, cwd: string, mode?: TerminalMode, resume?: boolean) => Promise<string>
  killTerminal: (sessionId: string, mode?: TerminalMode) => Promise<void>
  getTerminal: (sessionId: string, mode?: TerminalMode) => TerminalInstance | undefined

  /** Spawn a terminal keyed by a dynamic tab ID + session ID */
  spawnDynamicTerminal: (
    tabId: string,
    sessionId: string,
    sessionName: string,
    cwd: string,
    mode: TerminalMode
  ) => Promise<string>

  /** Kill a dynamic terminal by tab ID + session ID */
  killDynamicTerminal: (tabId: string, sessionId: string) => Promise<void>

  /** Get a dynamic terminal instance */
  getDynamicTerminal: (tabId: string, sessionId: string) => TerminalInstance | undefined

  /** Kill all dynamic terminals for a given tab ID (all sessions) */
  killDynamicTerminalAll: (tabId: string) => Promise<void>

  /** Kill all terminals (static + dynamic) for a given session */
  killAllForSession: (sessionId: string) => Promise<void>

  /** Recover terminals from a previous session (after crash/restart) */
  recoverTerminals: (sessions: Array<{ id: string; name: string; worktreePath: string }>) => Promise<void>
}

function terminalKey(sessionId: string, mode: TerminalMode) {
  return `${sessionId}:${mode}`
}

function dynamicKey(tabId: string, sessionId: string) {
  return `dyn:${tabId}:${sessionId}`
}

function getActiveProjectConfigDir(): string | undefined {
  const { projects, activeProjectId, claudeAccounts } = useProjectStore.getState()
  const project = projects.find((p) => p.id === activeProjectId)
  if (!project?.claudeAccountId) return undefined
  const account = claudeAccounts.find((a) => a.id === project.claudeAccountId)
  return account?.configDir
}

function getActiveProjectRepoPath(): string | undefined {
  const { projects, activeProjectId } = useProjectStore.getState()
  const project = projects.find((p) => p.id === activeProjectId)
  return project?.repoPath
}

// Tracks in-flight spawns by key so concurrent callers (e.g. React StrictMode
// double-invoked effects) dedupe onto a single PTY rather than racing to spawn
// two and leaving an orphan running in the main process.
const spawningTerminals = new Map<string, Promise<string>>()

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},

  spawnTerminal: async (sessionId: string, sessionName: string, cwd: string, mode: TerminalMode = 'shell', resume = false) => {
    const key = terminalKey(sessionId, mode)
    const existing = get().terminals[key]
    if (existing) return existing.terminalId

    const inFlight = spawningTerminals.get(key)
    if (inFlight) return inFlight

    const { claudeTheme } = useSettingsStore.getState()
    const claudeConfigDir = getActiveProjectConfigDir()
    const repoPath = getActiveProjectRepoPath()
    const promise = (async () => {
      try {
        const terminalId = await window.api.terminal.spawn(sessionId, cwd, mode, claudeTheme, claudeConfigDir, repoPath, resume)
        set((state) => ({
          terminals: {
            ...state.terminals,
            [key]: { terminalId, sessionId, sessionName, mode },
          },
        }))
        return terminalId
      } finally {
        spawningTerminals.delete(key)
      }
    })()
    spawningTerminals.set(key, promise)
    return promise
  },

  killTerminal: async (sessionId: string, mode: TerminalMode = 'shell') => {
    const key = terminalKey(sessionId, mode)
    const instance = get().terminals[key]
    if (instance) {
      destroyTerminal(instance.terminalId)
      await window.api.terminal.kill(instance.terminalId)
      set((state) => {
        const { [key]: _, ...rest } = state.terminals
        return { terminals: rest }
      })
    }
  },

  getTerminal: (sessionId: string, mode: TerminalMode = 'shell') => {
    const key = terminalKey(sessionId, mode)
    return get().terminals[key]
  },

  spawnDynamicTerminal: async (tabId, sessionId, sessionName, cwd, mode) => {
    const key = dynamicKey(tabId, sessionId)
    const existing = get().terminals[key]
    if (existing) return existing.terminalId

    const inFlight = spawningTerminals.get(key)
    if (inFlight) return inFlight

    const { claudeTheme } = useSettingsStore.getState()
    const claudeConfigDir = getActiveProjectConfigDir()
    const repoPath = getActiveProjectRepoPath()
    const promise = (async () => {
      try {
        const terminalId = await window.api.terminal.spawn(sessionId, cwd, mode, claudeTheme, claudeConfigDir, repoPath)
        set((state) => ({
          terminals: {
            ...state.terminals,
            [key]: { terminalId, sessionId, sessionName, mode },
          },
        }))
        return terminalId
      } finally {
        spawningTerminals.delete(key)
      }
    })()
    spawningTerminals.set(key, promise)
    return promise
  },

  killDynamicTerminal: async (tabId, sessionId) => {
    const key = dynamicKey(tabId, sessionId)
    const instance = get().terminals[key]
    if (instance) {
      destroyTerminal(instance.terminalId)
      await window.api.terminal.kill(instance.terminalId)
      set((state) => {
        const { [key]: _, ...rest } = state.terminals
        return { terminals: rest }
      })
    }
  },

  getDynamicTerminal: (tabId, sessionId) => {
    const key = dynamicKey(tabId, sessionId)
    return get().terminals[key]
  },

  killDynamicTerminalAll: async (tabId) => {
    const allTerminals = get().terminals
    const keysToKill = Object.keys(allTerminals).filter((k) => k.startsWith(`dyn:${tabId}:`))
    for (const key of keysToKill) {
      const instance = allTerminals[key]
      if (instance) {
        destroyTerminal(instance.terminalId)
        await window.api.terminal.kill(instance.terminalId)
      }
    }
    if (keysToKill.length > 0) {
      set((state) => {
        const rest = { ...state.terminals }
        for (const key of keysToKill) {
          delete rest[key]
        }
        return { terminals: rest }
      })
    }
  },

  killAllForSession: async (sessionId: string) => {
    const allTerminals = get().terminals
    const keysToKill = Object.keys(allTerminals).filter((key) => {
      const instance = allTerminals[key]
      return instance.sessionId === sessionId
    })

    for (const key of keysToKill) {
      const instance = allTerminals[key]
      if (instance) {
        destroyTerminal(instance.terminalId)
      }
    }

    // The main process handles PTY cleanup via killSession IPC
    // (called separately by sessionStore.removeSession)

    if (keysToKill.length > 0) {
      set((state) => {
        const rest = { ...state.terminals }
        for (const key of keysToKill) {
          delete rest[key]
        }
        return { terminals: rest }
      })
    }
  },

  recoverTerminals: async (sessions) => {
    const recoveryList = await window.api.terminal.getRecoveryList()
    if (recoveryList.length === 0) return

    const sessionMap = new Map(sessions.map((s) => [s.id, s]))

    for (const entry of recoveryList) {
      const session = sessionMap.get(entry.sessionId)
      if (!session) continue // Session was deleted, skip recovery

      // Only recover claude and shell terminals (review terminals are ephemeral)
      if (entry.mode === 'review') continue

      const resume = entry.mode === 'claude'
      try {
        await get().spawnTerminal(
          session.id,
          session.name,
          entry.cwd,
          entry.mode,
          resume
        )
      } catch {
        // Terminal recovery is best-effort
      }
    }
  },
}))

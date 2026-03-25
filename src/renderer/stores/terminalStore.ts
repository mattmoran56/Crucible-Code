import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'

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
  spawnTerminal: (sessionId: string, sessionName: string, cwd: string, mode?: TerminalMode) => Promise<string>
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
}

function terminalKey(sessionId: string, mode: TerminalMode) {
  return `${sessionId}:${mode}`
}

function dynamicKey(tabId: string, sessionId: string) {
  return `dyn:${tabId}:${sessionId}`
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},

  spawnTerminal: async (sessionId: string, sessionName: string, cwd: string, mode: TerminalMode = 'shell') => {
    const key = terminalKey(sessionId, mode)
    const existing = get().terminals[key]
    if (existing) return existing.terminalId

    const { claudeTheme } = useSettingsStore.getState()
    const terminalId = await window.api.terminal.spawn(sessionId, cwd, mode, claudeTheme)
    set((state) => ({
      terminals: {
        ...state.terminals,
        [key]: { terminalId, sessionId, sessionName, mode },
      },
    }))
    return terminalId
  },

  killTerminal: async (sessionId: string, mode: TerminalMode = 'shell') => {
    const key = terminalKey(sessionId, mode)
    const instance = get().terminals[key]
    if (instance) {
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

    const { theme } = useSettingsStore.getState()
    const isDark = THEMES.find((t) => t.name === theme)?.isDark ?? true
    const terminalId = await window.api.terminal.spawn(sessionId, cwd, mode, isDark)
    set((state) => ({
      terminals: {
        ...state.terminals,
        [key]: { terminalId, sessionId, sessionName, mode },
      },
    }))
    return terminalId
  },

  killDynamicTerminal: async (tabId, sessionId) => {
    const key = dynamicKey(tabId, sessionId)
    const instance = get().terminals[key]
    if (instance) {
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
}))

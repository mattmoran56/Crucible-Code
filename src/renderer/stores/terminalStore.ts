import { create } from 'zustand'

type TerminalMode = 'shell' | 'claude'

interface TerminalInstance {
  terminalId: string
  sessionId: string
  mode: TerminalMode
}

interface TerminalState {
  // Keyed by `${sessionId}:${mode}` so each session can have both a claude and shell terminal
  terminals: Record<string, TerminalInstance>
  spawnTerminal: (sessionId: string, cwd: string, mode?: TerminalMode) => Promise<string>
  killTerminal: (sessionId: string, mode?: TerminalMode) => Promise<void>
  getTerminal: (sessionId: string, mode?: TerminalMode) => TerminalInstance | undefined
}

function terminalKey(sessionId: string, mode: TerminalMode) {
  return `${sessionId}:${mode}`
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},

  spawnTerminal: async (sessionId: string, cwd: string, mode: TerminalMode = 'shell') => {
    const key = terminalKey(sessionId, mode)
    const existing = get().terminals[key]
    if (existing) return existing.terminalId

    const terminalId = await window.api.terminal.spawn(sessionId, cwd, mode)
    set((state) => ({
      terminals: {
        ...state.terminals,
        [key]: { terminalId, sessionId, mode },
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
}))

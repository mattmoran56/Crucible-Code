import { create } from 'zustand'

interface TerminalInstance {
  terminalId: string
  sessionId: string
}

interface TerminalState {
  terminals: Record<string, TerminalInstance> // keyed by sessionId
  spawnTerminal: (sessionId: string, cwd: string) => Promise<string>
  killTerminal: (sessionId: string) => Promise<void>
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},

  spawnTerminal: async (sessionId: string, cwd: string) => {
    const existing = get().terminals[sessionId]
    if (existing) return existing.terminalId

    const terminalId = await window.api.terminal.spawn(sessionId, cwd)
    set((state) => ({
      terminals: {
        ...state.terminals,
        [sessionId]: { terminalId, sessionId },
      },
    }))
    return terminalId
  },

  killTerminal: async (sessionId: string) => {
    const instance = get().terminals[sessionId]
    if (instance) {
      await window.api.terminal.kill(instance.terminalId)
      set((state) => {
        const { [sessionId]: _, ...rest } = state.terminals
        return { terminals: rest }
      })
    }
  },
}))

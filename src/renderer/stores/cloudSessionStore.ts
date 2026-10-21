import { create } from 'zustand'

/**
 * Runtime-only state for cloud sessions' Agent tabs (never persisted).
 *
 * `teleports` holds the PTY a teleport is running in, per app session. While
 * an entry exists the Agent tab keeps showing that PTY even though the session
 * is now `location: 'local'` — the PTY IS the live local Claude session for
 * this run. Next launch there is no entry, so the tab opens as a normal visual
 * agent resuming the teleported conversation.
 */
interface CloudSessionState {
  teleports: Record<string, string>
  setTeleport: (sessionId: string, terminalId: string) => void
  clearTeleport: (sessionId: string) => void
}

export const useCloudSessionStore = create<CloudSessionState>((set) => ({
  teleports: {},
  setTeleport: (sessionId, terminalId) => set((s) => ({ teleports: { ...s.teleports, [sessionId]: terminalId } })),
  clearTeleport: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.teleports)) return s
      const { [sessionId]: _, ...rest } = s.teleports
      return { teleports: rest }
    }),
}))

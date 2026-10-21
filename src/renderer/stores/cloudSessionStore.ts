import { create } from 'zustand'
import type { BranchMismatch } from '../lib/teleportBranch'

/**
 * Runtime-only state for cloud sessions' Agent tabs (never persisted).
 *
 * `teleports` holds the PTY a teleport is running in, per app session. While
 * an entry exists the Agent tab keeps showing that PTY even though the session
 * is now `location: 'local'` — the PTY IS the live local Claude session for
 * this run. Next launch there is no entry, so the tab opens as a normal visual
 * agent resuming the teleported conversation.
 *
 * `branchNotices` holds, per app session, a teleport that landed on a
 * different branch than the app created — shown until dismissed.
 */
interface CloudSessionState {
  teleports: Record<string, string>
  setTeleport: (sessionId: string, terminalId: string) => void
  clearTeleport: (sessionId: string) => void
  branchNotices: Record<string, BranchMismatch>
  setBranchNotice: (sessionId: string, notice: BranchMismatch | null) => void
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
  branchNotices: {},
  setBranchNotice: (sessionId, notice) =>
    set((s) => {
      if (notice) return { branchNotices: { ...s.branchNotices, [sessionId]: notice } }
      if (!(sessionId in s.branchNotices)) return s
      const { [sessionId]: _, ...rest } = s.branchNotices
      return { branchNotices: rest }
    }),
}))

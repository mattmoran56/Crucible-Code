import { create } from 'zustand'
import type { CloudCreateState, CloudTeleportState } from '../../shared/types'
import type { BranchMismatch } from '../lib/teleportBranch'

/**
 * Runtime-only state for cloud sessions' Agent tabs (never persisted).
 *
 * `teleports` holds the PTY a teleport is running in, per app session. While
 * an entry exists the Agent tab shows the "Teleporting…" view over that PTY
 * even though the session is now `location: 'local'`. Once the conversation
 * is local the entry is cleared and the tab resumes it as a visual agent
 * (lib/cloudTeleport). `teleportRuns` mirrors the main process's teleport run
 * (steps, needs-input, done/failed) per app session.
 *
 * `branchNotices` holds, per app session, a teleport that landed on a
 * different branch than the app created — shown until dismissed.
 *
 * `creates` mirrors the main process's interactive `claude --cloud` create
 * runs (per app session). `autoStart` marks sessions created in this run whose
 * Agent tab should start that run on first mount; a pending session without
 * the mark (e.g. after an app restart) offers Retry instead of re-running the
 * CLI on its own, which could create a second cloud session.
 */
interface CloudSessionState {
  teleports: Record<string, string>
  setTeleport: (sessionId: string, terminalId: string) => void
  clearTeleport: (sessionId: string) => void
  teleportRuns: Record<string, CloudTeleportState>
  setTeleportRun: (state: CloudTeleportState) => void
  branchNotices: Record<string, BranchMismatch>
  setBranchNotice: (sessionId: string, notice: BranchMismatch | null) => void
  creates: Record<string, CloudCreateState>
  setCreate: (state: CloudCreateState) => void
  autoStart: Record<string, true>
  requestAutoStart: (sessionId: string) => void
  /** True once for a session marked by requestAutoStart. */
  consumeAutoStart: (sessionId: string) => boolean
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
  teleportRuns: {},
  setTeleportRun: (state) => set((s) => ({ teleportRuns: { ...s.teleportRuns, [state.sessionId]: state } })),
  branchNotices: {},
  setBranchNotice: (sessionId, notice) =>
    set((s) => {
      if (notice) return { branchNotices: { ...s.branchNotices, [sessionId]: notice } }
      if (!(sessionId in s.branchNotices)) return s
      const { [sessionId]: _, ...rest } = s.branchNotices
      return { branchNotices: rest }
    }),
  creates: {},
  setCreate: (state) => set((s) => ({ creates: { ...s.creates, [state.sessionId]: state } })),
  autoStart: {},
  requestAutoStart: (sessionId) => set((s) => ({ autoStart: { ...s.autoStart, [sessionId]: true } })),
  consumeAutoStart: (sessionId) => {
    if (!useCloudSessionStore.getState().autoStart[sessionId]) return false
    set((s) => {
      const { [sessionId]: _, ...rest } = s.autoStart
      return { autoStart: rest }
    })
    return true
  },
}))

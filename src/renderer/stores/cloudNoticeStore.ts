import { create } from 'zustand'
import type { CloudNotice } from '../../shared/cloud-session'

/**
 * The latest notification each cloud session's claude.ai page raised
 * ("needs your input", "finished"…), relayed into Crucible (see
 * lib/cloudNotifications). The session card and the cloud Agent tab show it so
 * that after clicking the OS notification you can still see what it said; it
 * stays until dismissed or replaced by the next one. Runtime-only.
 */
interface CloudNoticeState {
  notices: Record<string, CloudNotice>
  setNotice: (sessionId: string, notice: CloudNotice) => void
  dismiss: (sessionId: string) => void
}

export const useCloudNoticeStore = create<CloudNoticeState>((set) => ({
  notices: {},
  setNotice: (sessionId, notice) => set((s) => ({ notices: { ...s.notices, [sessionId]: notice } })),
  dismiss: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.notices)) return s
      const notices = { ...s.notices }
      delete notices[sessionId]
      return { notices }
    }),
}))

import { create } from 'zustand'
import type { UpdateStatus } from '../../../shared/types'

interface UpdateState {
  status: UpdateStatus
  log: string[]
  setStatus: (status: UpdateStatus) => void
  appendLog: (line: string) => void
  reset: () => void
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: { state: 'idle' },
  log: [],

  setStatus: (status) => set({ status }),
  appendLog: (line) => set((s) => ({ log: [...s.log, line] })),
  reset: () => set({ status: { state: 'idle' }, log: [] }),
}))

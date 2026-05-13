import { create } from 'zustand'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopProjectOverride,
  type ReviewLoopSettings,
  type ReviewLoopState,
} from '../../shared/types'
import { useToastStore } from './toastStore'

interface ReviewLoopStoreState {
  settings: ReviewLoopSettings
  loaded: boolean
  /** Latest state per session id (only populated for sessions whose loop has been observed) */
  states: Record<string, ReviewLoopState>

  loadSettings: () => Promise<void>
  setWorkspaceConfig: (config: ReviewLoopConfig) => Promise<void>
  setProjectOverride: (
    projectId: string,
    override: ReviewLoopProjectOverride | undefined
  ) => Promise<void>
  /** Resolve effective config for a project, applying per-project overrides. */
  effectiveConfig: (projectId: string | null) => ReviewLoopConfig
  /** Toggle the per-project enabled flag (persists). */
  setProjectEnabled: (projectId: string, enabled: boolean) => Promise<void>

  start: (opts: {
    sessionId: string
    worktreePath: string
    branch: string
    baseBranch: string
    projectId: string
    prNumber?: number
  }) => Promise<void>
  cancel: (sessionId: string) => Promise<void>
  refreshState: (sessionId: string) => Promise<void>
  applyState: (state: ReviewLoopState) => void
}

const DEFAULT_SETTINGS: ReviewLoopSettings = {
  workspace: DEFAULT_REVIEW_LOOP_CONFIG,
  projectOverrides: {},
}

export const useReviewLoopStore = create<ReviewLoopStoreState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  states: {},

  loadSettings: async () => {
    try {
      const settings = await window.api.reviewLoop.getSettings()
      set({ settings, loaded: true })
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to load review loop settings')
      set({ loaded: true })
    }
  },

  setWorkspaceConfig: async (config) => {
    const next: ReviewLoopSettings = { ...get().settings, workspace: config }
    set({ settings: next })
    try {
      await window.api.reviewLoop.setSettings(next)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to save')
    }
  },

  setProjectOverride: async (projectId, override) => {
    const overrides = { ...get().settings.projectOverrides }
    if (!override || Object.keys(override).length === 0) {
      delete overrides[projectId]
    } else {
      overrides[projectId] = override
    }
    const next: ReviewLoopSettings = { ...get().settings, projectOverrides: overrides }
    set({ settings: next })
    try {
      await window.api.reviewLoop.setSettings(next)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to save')
    }
  },

  effectiveConfig: (projectId) => {
    const { workspace, projectOverrides } = get().settings
    if (!projectId) return workspace
    const override = projectOverrides[projectId]
    if (!override) return workspace
    return {
      enabled: override.enabled ?? workspace.enabled,
      variant: override.variant ?? workspace.variant,
      maxIterations: override.maxIterations ?? workspace.maxIterations,
      consecutiveCleanRounds: override.consecutiveCleanRounds ?? workspace.consecutiveCleanRounds,
      costCapUsd: override.costCapUsd ?? workspace.costCapUsd,
    }
  },

  setProjectEnabled: async (projectId, enabled) => {
    const overrides = { ...get().settings.projectOverrides }
    const existing = overrides[projectId] ?? {}
    overrides[projectId] = { ...existing, enabled }
    const next: ReviewLoopSettings = { ...get().settings, projectOverrides: overrides }
    set({ settings: next })
    try {
      await window.api.reviewLoop.setSettings(next)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to save')
    }
  },

  start: async ({ sessionId, worktreePath, branch, baseBranch, projectId, prNumber }) => {
    const config = get().effectiveConfig(projectId)
    if (!config.enabled) {
      useToastStore.getState().addToast('info', 'Review loop is disabled for this project')
      return
    }
    try {
      await window.api.reviewLoop.start({
        sessionId,
        worktreePath,
        branch,
        baseBranch,
        config,
        prNumber,
      })
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to start review loop')
    }
  },

  cancel: async (sessionId) => {
    try {
      await window.api.reviewLoop.cancel(sessionId)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message ?? 'Failed to cancel review loop')
    }
  },

  refreshState: async (sessionId) => {
    try {
      const state = await window.api.reviewLoop.getState(sessionId)
      if (state) get().applyState(state)
    } catch {
      // Silent — handled in UI when state is missing.
    }
  },

  applyState: (state) => {
    set((prev) => ({ states: { ...prev.states, [state.sessionId]: state } }))
  },
}))

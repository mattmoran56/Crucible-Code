import { create } from 'zustand'
import type {
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  NotionTestConnectionResult,
} from '../../shared/types'
import { useToastStore } from './toastStore'

export const DEFAULT_NOTION_CONFIG: NotionIntegrationConfig = {
  enabled: false,
  apiToken: '',
  databaseId: '',
  filters: [],
  pickupUpdates: [],
  pickupAppendMarkdown: '',
  startupPromptTemplate: '/notion-ticket {{taskUrl}}',
  titlePropertyName: undefined,
  branchNameTemplate: 'notion/{{taskTitleSlug}}',
}

interface NotionState {
  configByProject: Record<string, NotionIntegrationConfig>
  schemaByProject: Record<string, NotionDatabaseSchema>
  loadingProjects: Set<string>
  configPath: string | null

  load: (projectId: string) => Promise<void>
  save: (
    projectId: string,
    config: NotionIntegrationConfig,
    opts?: { backfill?: boolean }
  ) => Promise<void>
  testConnection: (token: string, databaseId: string) => Promise<NotionTestConnectionResult>
  loadSchema: (projectId: string, token: string, databaseId: string) => Promise<void>
  clearPickedUp: (projectId: string) => Promise<void>
  loadConfigPath: () => Promise<void>
}

export const useNotionStore = create<NotionState>((set, get) => ({
  configByProject: {},
  schemaByProject: {},
  loadingProjects: new Set(),
  configPath: null,

  load: async (projectId: string) => {
    if (get().loadingProjects.has(projectId)) return
    set((state) => {
      const next = new Set(state.loadingProjects)
      next.add(projectId)
      return { loadingProjects: next }
    })
    try {
      const config = await window.api.notion.loadConfig(projectId)
      set((state) => ({
        configByProject: {
          ...state.configByProject,
          [projectId]: config ?? { ...DEFAULT_NOTION_CONFIG },
        },
      }))
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      set((state) => {
        const next = new Set(state.loadingProjects)
        next.delete(projectId)
        return { loadingProjects: next }
      })
    }
  },

  save: async (projectId, config, opts) => {
    set((state) => ({
      configByProject: { ...state.configByProject, [projectId]: config },
    }))
    try {
      await window.api.notion.saveConfig(projectId, config, opts)
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  testConnection: async (token, databaseId) => {
    return window.api.notion.testConnection(token, databaseId)
  },

  loadSchema: async (projectId, token, databaseId) => {
    try {
      const schema = await window.api.notion.getDatabaseSchema(token, databaseId)
      set((state) => ({
        schemaByProject: { ...state.schemaByProject, [projectId]: schema },
      }))
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  clearPickedUp: async (projectId) => {
    try {
      await window.api.notion.clearPickedUp(projectId)
      useToastStore.getState().addToast('success', 'Cleared picked-up cache')
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  loadConfigPath: async () => {
    try {
      const p = await window.api.notion.getConfigPath()
      set({ configPath: p })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },
}))

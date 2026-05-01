import { create } from 'zustand'
import type { StartupPrompt } from '../../shared/types'
import { useToastStore } from './toastStore'

interface StartupPromptState {
  byProject: Record<string, StartupPrompt[]>
  loadingProjects: Set<string>

  load: (projectId: string) => Promise<void>
  getForProject: (projectId: string) => StartupPrompt[]
  save: (projectId: string, prompts: StartupPrompt[]) => Promise<void>
  add: (projectId: string, prompt: StartupPrompt) => Promise<void>
  update: (projectId: string, prompt: StartupPrompt) => Promise<void>
  remove: (projectId: string, promptId: string) => Promise<void>
  reorder: (projectId: string, orderedIds: string[]) => Promise<void>
}

export const useStartupPromptStore = create<StartupPromptState>((set, get) => ({
  byProject: {},
  loadingProjects: new Set(),

  load: async (projectId: string) => {
    if (get().loadingProjects.has(projectId)) return
    set((state) => {
      const next = new Set(state.loadingProjects)
      next.add(projectId)
      return { loadingProjects: next }
    })
    try {
      const prompts = await window.api.startupPrompt.list(projectId)
      const sorted = [...prompts].sort((a, b) => a.order - b.order)
      set((state) => ({ byProject: { ...state.byProject, [projectId]: sorted } }))
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    } finally {
      set((state) => {
        const next = new Set(state.loadingProjects)
        next.delete(projectId)
        return { loadingProjects: next }
      })
    }
  },

  getForProject: (projectId: string) => {
    return get().byProject[projectId] ?? []
  },

  save: async (projectId: string, prompts: StartupPrompt[]) => {
    const sorted = [...prompts].sort((a, b) => a.order - b.order)
    set((state) => ({ byProject: { ...state.byProject, [projectId]: sorted } }))
    try {
      await window.api.startupPrompt.save(projectId, sorted)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  add: async (projectId: string, prompt: StartupPrompt) => {
    const existing = get().byProject[projectId] ?? []
    await get().save(projectId, [...existing, prompt])
  },

  update: async (projectId: string, prompt: StartupPrompt) => {
    const existing = get().byProject[projectId] ?? []
    const next = existing.map((p) => (p.id === prompt.id ? prompt : p))
    await get().save(projectId, next)
  },

  remove: async (projectId: string, promptId: string) => {
    const existing = get().byProject[projectId] ?? []
    const next = existing.filter((p) => p.id !== promptId)
    await get().save(projectId, next)
  },

  reorder: async (projectId: string, orderedIds: string[]) => {
    const existing = get().byProject[projectId] ?? []
    const next = existing
      .map((p) => {
        const idx = orderedIds.indexOf(p.id)
        return idx >= 0 ? { ...p, order: idx } : p
      })
      .sort((a, b) => a.order - b.order)
    await get().save(projectId, next)
  },
}))

export function promptNeedsInput(command: string): boolean {
  return /\{\{input\}\}/.test(command)
}

export function resolveStartupCommand(command: string, input: string): string {
  return command.replace(/\{\{input\}\}/g, input)
}

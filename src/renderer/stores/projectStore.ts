import { create } from 'zustand'
import type { Project, ClaudeAccount, WindowLayout } from '../../shared/types'
import { neighbourAfterClose } from '../lib/tabOrder'

interface ProjectState {
  /** Every registered project (shared by all windows). */
  projects: Project[]
  activeProjectId: string | null
  claudeAccounts: ClaudeAccount[]
  /**
   * This window's id when the app runs with multiple windows; null when there
   * is no window manager (mock app, tests) and every project is a tab.
   */
  windowId: string | null
  /** Project ids shown as tabs in this window, in order (only used when windowId is set). */
  tabIds: string[]
  loadProjects: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  reorderProjects: (projectIds: string[]) => Promise<void>
  setActiveProject: (id: string) => void
  updateProject: (project: Project) => Promise<void>
  /**
   * Hide a project (close its tab everywhere, keep everything else) or show it
   * again. Unhiding opens it as a tab in this window.
   */
  setProjectHidden: (id: string, hidden: boolean) => Promise<void>
  loadAccounts: () => Promise<void>
  saveAccounts: (accounts: ClaudeAccount[]) => Promise<void>
  /** Reorder this window's tabs. */
  reorderTabs: (projectIds: string[]) => Promise<void>
  /** Close a tab in this window only (the project stays open in another window). */
  closeTab: (id: string) => void
  /** Main process changed this window's tabs (a tab moved in or out). */
  applyWindowLayout: (layout: WindowLayout) => void
}

/** The projects this window shows as tabs, in tab order. */
export function selectTabProjects(state: Pick<ProjectState, 'projects' | 'windowId' | 'tabIds'>): Project[] {
  if (!state.windowId) return state.projects.filter((p) => !p.hidden)
  const byId = new Map(state.projects.map((p) => [p.id, p]))
  return state.tabIds.map((id) => byId.get(id)).filter((p): p is Project => !!p && !p.hidden)
}

function windowsApi() {
  return typeof window !== 'undefined' ? window.api?.windows : undefined
}

export const useProjectStore = create<ProjectState>((set, get) => {
  /** Tell the main process this window's tabs / active project. */
  const syncLayout = () => {
    const { windowId, tabIds, activeProjectId } = get()
    if (!windowId) return
    void windowsApi()?.setLayout(tabIds, activeProjectId)?.catch?.(() => {})
  }

  return {
    projects: [],
    activeProjectId: null,
    claudeAccounts: [],
    windowId: null,
    tabIds: [],

    loadProjects: async () => {
      const projects = await window.api.project.list()
      let layout: WindowLayout | null = null
      try {
        layout = (await windowsApi()?.getLayout?.()) ?? null
      } catch {
        layout = null
      }

      if (!layout) {
        const visible = projects.filter((p) => !p.hidden)
        const current = get().activeProjectId
        const currentHidden = projects.some((p) => p.id === current && p.hidden)
        set({
          projects,
          activeProjectId: visible.length > 0 ? (current && !currentHidden ? current : visible[0].id) : null,
        })
        return
      }

      const known = new Set(projects.filter((p) => !p.hidden).map((p) => p.id))
      const tabIds = layout.projectIds.filter((id) => known.has(id))
      const current = get().activeProjectId
      const activeProjectId =
        current && tabIds.includes(current)
          ? current
          : layout.activeProjectId && tabIds.includes(layout.activeProjectId)
            ? layout.activeProjectId
            : tabIds[0] ?? null
      set({ projects, windowId: layout.windowId, tabIds, activeProjectId })
    },

    addProject: async () => {
      const folderPath = await window.api.project.selectFolder()
      if (!folderPath) return

      const name = folderPath.split('/').pop() || folderPath
      const project: Project = {
        id: crypto.randomUUID(),
        name,
        repoPath: folderPath,
      }

      const projects = await window.api.project.add(project)
      const { windowId, tabIds } = get()
      set({
        projects,
        activeProjectId: project.id,
        tabIds: windowId && !tabIds.includes(project.id) ? [...tabIds, project.id] : tabIds,
      })
      syncLayout()
    },

    removeProject: async (id: string) => {
      const projects = await window.api.project.remove(id)
      const state = get()
      if (state.windowId) {
        const tabIds = state.tabIds.filter((t) => t !== id)
        set({
          projects,
          tabIds,
          activeProjectId:
            state.activeProjectId === id ? neighbourAfterClose(state.tabIds, id) : state.activeProjectId,
        })
        return
      }
      set({
        projects,
        activeProjectId: state.activeProjectId === id
          ? (projects.find((p) => !p.hidden)?.id ?? null)
          : state.activeProjectId,
      })
    },

    reorderProjects: async (projectIds: string[]) => {
      const projects = await window.api.project.reorder(projectIds)
      set({ projects })
    },

    setActiveProject: (id: string) => {
      const { windowId, tabIds, projects } = get()
      // A hidden project has no tab to show; unhide it from Settings first.
      if (projects.find((p) => p.id === id)?.hidden) return
      // Activating a project this window doesn't show (e.g. from a
      // notification click) opens it here as a tab.
      set({
        activeProjectId: id,
        tabIds: windowId && !tabIds.includes(id) ? [...tabIds, id] : tabIds,
      })
      syncLayout()
    },

    updateProject: async (project: Project) => {
      const projects = await window.api.project.update(project)
      set({ projects })
    },

    setProjectHidden: async (id: string, hidden: boolean) => {
      const project = get().projects.find((p) => p.id === id)
      if (!project || !!project.hidden === hidden) return
      const { hidden: _wasHidden, ...rest } = project
      const projects = await window.api.project.update(hidden ? { ...rest, hidden: true } : rest)
      const state = get()
      if (state.windowId) {
        // Main also pushes the new layout; mirror it here so the tab goes at once.
        if (hidden) {
          set({
            projects,
            tabIds: state.tabIds.filter((t) => t !== id),
            activeProjectId:
              state.activeProjectId === id ? neighbourAfterClose(state.tabIds, id) : state.activeProjectId,
          })
        } else {
          set({
            projects,
            tabIds: state.tabIds.includes(id) ? state.tabIds : [...state.tabIds, id],
            activeProjectId: id,
          })
        }
        return
      }
      if (hidden) {
        const before = state.projects.filter((p) => !p.hidden).map((p) => p.id)
        set({
          projects,
          activeProjectId: state.activeProjectId === id ? neighbourAfterClose(before, id) : state.activeProjectId,
        })
      } else {
        set({ projects, activeProjectId: id })
      }
    },

    loadAccounts: async () => {
      const claudeAccounts = await window.api.account.list()
      set({ claudeAccounts })
    },

    saveAccounts: async (accounts: ClaudeAccount[]) => {
      await window.api.account.save(accounts)
      set({ claudeAccounts: accounts })
    },

    reorderTabs: async (projectIds: string[]) => {
      if (!get().windowId) {
        await get().reorderProjects(projectIds)
        return
      }
      set({ tabIds: projectIds })
      syncLayout()
    },

    closeTab: (id: string) => {
      const { windowId, tabIds, activeProjectId } = get()
      if (!windowId || !tabIds.includes(id)) return
      set({
        tabIds: tabIds.filter((t) => t !== id),
        activeProjectId: activeProjectId === id ? neighbourAfterClose(tabIds, id) : activeProjectId,
      })
      syncLayout()
    },

    applyWindowLayout: (layout: WindowLayout) => {
      set({
        windowId: layout.windowId,
        tabIds: layout.projectIds,
        activeProjectId: layout.activeProjectId,
      })
    },
  }
})

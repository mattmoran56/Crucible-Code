import { create } from 'zustand'
import type { Project } from '../../shared/types'

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  loadProjects: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (id: string) => Promise<void>
  reorderProjects: (projectIds: string[]) => Promise<void>
  setActiveProject: (id: string) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,

  loadProjects: async () => {
    const projects = await window.api.project.list()
    set({
      projects,
      activeProjectId: projects.length > 0 ? (get().activeProjectId ?? projects[0].id) : null,
    })
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
    set({ projects, activeProjectId: project.id })
  },

  removeProject: async (id: string) => {
    const projects = await window.api.project.remove(id)
    const state = get()
    set({
      projects,
      activeProjectId: state.activeProjectId === id
        ? (projects[0]?.id ?? null)
        : state.activeProjectId,
    })
  },

  reorderProjects: async (projectIds: string[]) => {
    const projects = await window.api.project.reorder(projectIds)
    set({ projects })
  },

  setActiveProject: (id: string) => {
    set({ activeProjectId: id })
  },
}))

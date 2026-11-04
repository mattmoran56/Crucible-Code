import { create } from 'zustand'
import type { DeskPR, DeskTicket } from '../../shared/prDesk'
import { ticketKey } from '../../shared/prDesk'

const UI_STORAGE_KEY = 'codecrucible-pr-desk-ui'

export type PRDeskView = 'compact' | 'expanded'
export type PRDeskScope = 'mine' | 'all'

export interface PRDeskUI {
  /** The PR list lives in the full-width bottom bar instead of the sidebar. */
  open: boolean
  /** The bar is folded down to its header. */
  collapsed: boolean
  view: PRDeskView
  scope: PRDeskScope
  height: number
}

export const DEFAULT_PR_DESK_UI: PRDeskUI = {
  open: false,
  collapsed: false,
  view: 'compact',
  scope: 'all',
  height: 260,
}

export interface PRDeskProjectData {
  prs: DeskPR[]
  loading: boolean
  hasLoaded: boolean
  error: string | null
  tickets: Record<string, DeskTicket>
  /** The project's Notion integration has a token and database. */
  notionConfigured: boolean
  notionError: string | null
  parked: number[]
}

const EMPTY_PROJECT: PRDeskProjectData = {
  prs: [],
  loading: false,
  hasLoaded: false,
  error: null,
  tickets: {},
  notionConfigured: false,
  notionError: null,
  parked: [],
}

interface PRDeskState extends PRDeskUI {
  byProject: Record<string, PRDeskProjectData>
  setUI: (patch: Partial<PRDeskUI>) => void
  load: (projectId: string, repoPath: string) => Promise<void>
  loadParked: (projectId: string) => Promise<void>
  toggleParked: (projectId: string, prNumber: number) => void
}

function loadUI(): PRDeskUI {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY)
    if (raw) return { ...DEFAULT_PR_DESK_UI, ...(JSON.parse(raw) as Partial<PRDeskUI>) }
  } catch { /* ignore */ }
  return { ...DEFAULT_PR_DESK_UI }
}

function saveUI(ui: PRDeskUI) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(ui))
  } catch { /* ignore */ }
}

function pickUI(s: PRDeskUI): PRDeskUI {
  return { open: s.open, collapsed: s.collapsed, view: s.view, scope: s.scope, height: s.height }
}

export function deskProject(state: { byProject: Record<string, PRDeskProjectData> }, projectId: string | null | undefined): PRDeskProjectData {
  return (projectId && state.byProject[projectId]) || EMPTY_PROJECT
}

export const usePRDeskStore = create<PRDeskState>((set, get) => {
  const patchProject = (projectId: string, patch: Partial<PRDeskProjectData>) =>
    set((s) => ({
      byProject: { ...s.byProject, [projectId]: { ...deskProject(s, projectId), ...patch } },
    }))

  return {
    ...loadUI(),
    byProject: {},

    setUI: (patch) => {
      set(patch)
      saveUI(pickUI(get()))
    },

    load: async (projectId, repoPath) => {
      patchProject(projectId, { loading: true })
      let prs: DeskPR[]
      try {
        prs = await window.api.prDesk.list(repoPath)
        patchProject(projectId, { prs, loading: false, hasLoaded: true, error: null })
      } catch (err) {
        patchProject(projectId, {
          loading: false,
          hasLoaded: true,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }

      const refs = prs.map((p) => p.ticket).filter((t): t is NonNullable<typeof t> => !!t && ticketKey(t) != null)
      if (refs.length === 0) return
      try {
        const res = await window.api.prDesk.tickets(projectId, refs)
        patchProject(projectId, {
          tickets: { ...deskProject(get(), projectId).tickets, ...res.tickets },
          notionConfigured: res.configured,
          notionError: res.error ?? null,
        })
      } catch (err) {
        patchProject(projectId, { notionError: err instanceof Error ? err.message : String(err) })
      }
    },

    loadParked: async (projectId) => {
      const parked = await window.api.prDesk.getParked(projectId)
      patchProject(projectId, { parked })
    },

    toggleParked: (projectId, prNumber) => {
      const current = deskProject(get(), projectId).parked
      const parked = current.includes(prNumber)
        ? current.filter((n) => n !== prNumber)
        : [...current, prNumber]
      patchProject(projectId, { parked })
      void window.api.prDesk.setParked(projectId, parked)
    },
  }
})

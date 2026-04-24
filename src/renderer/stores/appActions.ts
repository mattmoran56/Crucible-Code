import type { AppAction, ButtonPlacement } from '../../shared/types'
import { useSessionStore } from './sessionStore'
import { useProjectStore } from './projectStore'
import { useWorkspaceLayoutStore } from './workspaceLayoutStore'
import { useSettingsStore } from './settingsStore'

export interface AppActionDef {
  id: AppAction
  label: string
  group: string
  icon?: string
  validPlacements: ButtonPlacement[]
  requiresActiveSession?: boolean
  requiresActiveProject?: boolean
  defaultConfirmMessage?: string
  execute: () => void | Promise<void>
}

export function getAppActions(): AppActionDef[] {
  return [
    // ── Session ──────────────────────────────────────────────
    {
      id: 'session:open-as-main',
      label: 'Open as Main Branch',
      group: 'Session',
      icon: 'GitBranch',
      validPlacements: ['session-toolbar'],
      requiresActiveSession: true,
      requiresActiveProject: true,
      execute: () => {
        const { activeSessionId } = useSessionStore.getState()
        const { projects, activeProjectId } = useProjectStore.getState()
        const project = projects.find((p) => p.id === activeProjectId)
        if (project && activeSessionId) {
          return useSessionStore.getState().openAsMainBranch(project.repoPath, activeSessionId)
        }
      },
    },
    {
      id: 'session:return-to-worktree',
      label: 'Return to Worktree',
      group: 'Session',
      icon: 'ArrowRight',
      validPlacements: ['session-toolbar', 'project-tabs'],
      requiresActiveProject: true,
      execute: () => {
        const { projects, activeProjectId } = useProjectStore.getState()
        const project = projects.find((p) => p.id === activeProjectId)
        if (project) {
          return useSessionStore.getState().returnToWorktree(project.repoPath)
        }
      },
    },
    {
      id: 'session:delete',
      label: 'Delete Session',
      group: 'Session',
      icon: 'Trash',
      validPlacements: ['session-toolbar'],
      requiresActiveSession: true,
      requiresActiveProject: true,
      defaultConfirmMessage: 'Delete this session? This will remove the worktree and branch. This cannot be undone.',
      execute: () => {
        const { activeSessionId } = useSessionStore.getState()
        const { projects, activeProjectId } = useProjectStore.getState()
        const project = projects.find((p) => p.id === activeProjectId)
        if (project && activeProjectId && activeSessionId) {
          return useSessionStore.getState().removeSession(activeProjectId, project.repoPath, activeSessionId)
        }
      },
    },
    {
      id: 'session:mark-stale',
      label: 'Mark as Stale',
      group: 'Session',
      icon: 'Clock',
      validPlacements: ['session-toolbar'],
      requiresActiveSession: true,
      requiresActiveProject: true,
      execute: () => {
        const { activeSessionId } = useSessionStore.getState()
        const { activeProjectId } = useProjectStore.getState()
        if (activeProjectId && activeSessionId) {
          return useSessionStore.getState().markStale(activeProjectId, activeSessionId)
        }
      },
    },
    {
      id: 'session:reactivate',
      label: 'Reactivate Session',
      group: 'Session',
      icon: 'RefreshCw',
      validPlacements: ['session-toolbar'],
      requiresActiveSession: true,
      requiresActiveProject: true,
      execute: () => {
        const { activeSessionId } = useSessionStore.getState()
        const { activeProjectId } = useProjectStore.getState()
        if (activeProjectId && activeSessionId) {
          return useSessionStore.getState().reactivateSession(activeProjectId, activeSessionId)
        }
      },
    },
    {
      id: 'session:create',
      label: 'Create Session',
      group: 'Session',
      icon: 'Play',
      validPlacements: ['session-toolbar', 'project-tabs'],
      requiresActiveProject: true,
      execute: () => {
        window.dispatchEvent(new CustomEvent('app:create-session'))
      },
    },

    // ── Tabs ─────────────────────────────────────────────────
    {
      id: 'tab:open-agent',
      label: 'Open New Agent Tab',
      group: 'Tabs',
      icon: 'Sparkles',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, addDynamicTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) addDynamicTab(columns[0].id, 'agent')
      },
    },
    {
      id: 'tab:open-terminal',
      label: 'Open New Terminal Tab',
      group: 'Tabs',
      icon: 'Terminal',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, addDynamicTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) addDynamicTab(columns[0].id, 'terminal')
      },
    },
    {
      id: 'tab:switch-agent',
      label: 'Switch to Agent Tab',
      group: 'Tabs',
      icon: 'Sparkles',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) setActiveTab(columns[0].id, 'agent')
      },
    },
    {
      id: 'tab:switch-git',
      label: 'Switch to Git Tab',
      group: 'Tabs',
      icon: 'GitBranch',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) setActiveTab(columns[0].id, 'git')
      },
    },
    {
      id: 'tab:switch-pr',
      label: 'Switch to PR Tab',
      group: 'Tabs',
      icon: 'Eye',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) setActiveTab(columns[0].id, 'pr')
      },
    },
    {
      id: 'tab:switch-review',
      label: 'Switch to Review Tab',
      group: 'Tabs',
      icon: 'Search',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) setActiveTab(columns[0].id, 'review')
      },
    },
    {
      id: 'tab:switch-code',
      label: 'Switch to Code Tab',
      group: 'Tabs',
      icon: 'Code',
      validPlacements: ['session-toolbar'],
      execute: () => {
        const { columns, setActiveTab } = useWorkspaceLayoutStore.getState()
        if (columns[0]?.id) setActiveTab(columns[0].id, 'code')
      },
    },
    {
      id: 'tab:split-right',
      label: 'Split Column Right',
      group: 'Tabs',
      icon: 'Copy',
      validPlacements: ['session-toolbar'],
      execute: () => {
        useWorkspaceLayoutStore.getState().splitRight()
      },
    },

    // ── Project ──────────────────────────────────────────────
    {
      id: 'project:add',
      label: 'Add Project',
      group: 'Project',
      icon: 'Download',
      validPlacements: ['session-toolbar', 'project-tabs', 'right-activity-bar'],
      execute: () => {
        useProjectStore.getState().addProject()
      },
    },
    {
      id: 'project:remove',
      label: 'Remove Project',
      group: 'Project',
      icon: 'Trash',
      validPlacements: ['session-toolbar', 'project-tabs'],
      requiresActiveProject: true,
      defaultConfirmMessage: 'Remove this project from CodeCrucible? The repository will not be deleted.',
      execute: () => {
        const { activeProjectId } = useProjectStore.getState()
        if (activeProjectId) {
          useProjectStore.getState().removeProject(activeProjectId)
        }
      },
    },

    // ── App ──────────────────────────────────────────────────
    {
      id: 'app:open-settings',
      label: 'Open Settings',
      group: 'App',
      icon: 'Settings',
      validPlacements: ['session-toolbar', 'project-tabs', 'right-activity-bar'],
      execute: () => {
        useSettingsStore.getState().openSettings()
      },
    },
    {
      id: 'app:toggle-notes',
      label: 'Toggle Notes Panel',
      group: 'App',
      icon: 'FileText',
      validPlacements: ['session-toolbar', 'project-tabs', 'right-activity-bar'],
      execute: () => {
        window.dispatchEvent(new CustomEvent('app:toggle-panel', { detail: { panel: 'notes' } }))
      },
    },
    {
      id: 'app:toggle-usage',
      label: 'Toggle Usage Panel',
      group: 'App',
      icon: 'Clock',
      validPlacements: ['session-toolbar', 'project-tabs', 'right-activity-bar'],
      execute: () => {
        window.dispatchEvent(new CustomEvent('app:toggle-panel', { detail: { panel: 'usage' } }))
      },
    },
    {
      id: 'app:toggle-permissions',
      label: 'Toggle Permissions Panel',
      group: 'App',
      icon: 'Star',
      validPlacements: ['session-toolbar', 'project-tabs', 'right-activity-bar'],
      execute: () => {
        window.dispatchEvent(new CustomEvent('app:toggle-panel', { detail: { panel: 'permissions' } }))
      },
    },
  ]
}

export function getAppAction(id: string): AppActionDef | undefined {
  return getAppActions().find((a) => a.id === id)
}

export function getAppActionGroups(): { group: string; actions: AppActionDef[] }[] {
  const actions = getAppActions()
  const groupMap: Record<string, AppActionDef[]> = {}
  for (const a of actions) {
    ;(groupMap[a.group] ??= []).push(a)
  }
  return Object.entries(groupMap).map(([group, acts]) => ({ group, actions: acts }))
}

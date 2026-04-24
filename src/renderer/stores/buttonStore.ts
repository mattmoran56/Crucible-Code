import { create } from 'zustand'
import type {
  CustomButton,
  CustomButtonGroup,
  ButtonPlacement,
} from '../../shared/types'
import { useToastStore } from './toastStore'
import { useSessionStore } from './sessionStore'
import { useProjectStore } from './projectStore'
import { useTerminalStore } from './terminalStore'
import { useWorkspaceLayoutStore } from './workspaceLayoutStore'
import { getAppAction } from './appActions'

interface ButtonRunState {
  terminalId: string
  running: boolean
}

interface ButtonState {
  buttons: CustomButton[]
  groups: CustomButtonGroup[]
  runningButtons: Record<string, ButtonRunState>

  loadButtons: () => Promise<void>
  loadGroups: () => Promise<void>
  saveButtons: (buttons: CustomButton[]) => Promise<void>
  saveGroups: (groups: CustomButtonGroup[]) => Promise<void>
  addButton: (button: CustomButton) => Promise<void>
  updateButton: (button: CustomButton) => Promise<void>
  removeButton: (buttonId: string) => Promise<void>
  addGroup: (group: CustomButtonGroup) => Promise<void>
  updateGroup: (group: CustomButtonGroup) => Promise<void>
  removeGroup: (groupId: string) => Promise<void>
  reorderButtons: (placement: ButtonPlacement, orderedIds: string[]) => Promise<void>
  executeButton: (buttonId: string) => Promise<void>
  cancelButton: (buttonId: string) => void
  viewButtonOutput: (buttonId: string) => void
  setButtonRunState: (buttonId: string, state: ButtonRunState | null) => void
  getButtonsForPlacement: (placement: ButtonPlacement, projectId: string | null) => CustomButton[]
  getGroupedButtons: (
    placement: ButtonPlacement,
    projectId: string | null
  ) => {
    ungrouped: CustomButton[]
    groups: { group: CustomButtonGroup; buttons: CustomButton[] }[]
  }
}

function resolveTemplateVars(
  template: string,
  context: {
    branch?: string
    worktreePath?: string
    sessionName?: string
    repoPath?: string
    projectName?: string
  }
): string {
  return template
    .replace(/\{\{branch\}\}/g, context.branch ?? '')
    .replace(/\{\{worktreePath\}\}/g, context.worktreePath ?? '')
    .replace(/\{\{sessionName\}\}/g, context.sessionName ?? '')
    .replace(/\{\{repoPath\}\}/g, context.repoPath ?? '')
    .replace(/\{\{projectName\}\}/g, context.projectName ?? '')
}

function matchesScope(button: { scope: CustomButton['scope'] }, projectId: string | null): boolean {
  if (button.scope.type === 'global') return true
  if (button.scope.type === 'all-projects') return projectId !== null
  if (button.scope.type === 'projects') {
    return projectId !== null && button.scope.projectIds.includes(projectId)
  }
  return false
}

export const useButtonStore = create<ButtonState>()((set, get) => ({
  buttons: [],
  groups: [],
  runningButtons: {},

  loadButtons: async () => {
    try {
      const buttons = await window.api.button.list()
      set({ buttons })
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  loadGroups: async () => {
    try {
      const groups = await window.api.button.groupList()
      set({ groups })
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  saveButtons: async (buttons) => {
    set({ buttons })
    try {
      await window.api.button.save(buttons)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  saveGroups: async (groups) => {
    set({ groups })
    try {
      await window.api.button.groupSave(groups)
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  addButton: async (button) => {
    const buttons = [...get().buttons, button]
    await get().saveButtons(buttons)
  },

  updateButton: async (button) => {
    const buttons = get().buttons.map((b) => (b.id === button.id ? button : b))
    await get().saveButtons(buttons)
  },

  removeButton: async (buttonId) => {
    const buttons = get().buttons.filter((b) => b.id !== buttonId)
    await get().saveButtons(buttons)
  },

  addGroup: async (group) => {
    const groups = [...get().groups, group]
    await get().saveGroups(groups)
  },

  updateGroup: async (group) => {
    const groups = get().groups.map((g) => (g.id === group.id ? group : g))
    await get().saveGroups(groups)
  },

  removeGroup: async (groupId) => {
    // Remove group and ungroup its buttons
    const groups = get().groups.filter((g) => g.id !== groupId)
    const buttons = get().buttons.map((b) =>
      b.groupId === groupId ? { ...b, groupId: undefined } : b
    )
    await get().saveGroups(groups)
    await get().saveButtons(buttons)
  },

  reorderButtons: async (placement, orderedIds) => {
    const buttons = get().buttons.map((b) => {
      if (b.placement !== placement) return b
      const idx = orderedIds.indexOf(b.id)
      return idx >= 0 ? { ...b, order: idx } : b
    })
    await get().saveButtons(buttons)
  },

  executeButton: async (buttonId) => {
    const button = get().buttons.find((b) => b.id === buttonId)
    if (!button) return

    // Handle app-action type
    if (button.actionType === 'app-action') {
      const actionDef = getAppAction(button.command)
      if (!actionDef) {
        useToastStore.getState().addToast('error', `Unknown app action: ${button.command}`)
        return
      }
      if (actionDef.requiresActiveSession && !useSessionStore.getState().activeSessionId) {
        useToastStore.getState().addToast('warning', `"${button.label}" requires an active session`)
        return
      }
      if (actionDef.requiresActiveProject && !useProjectStore.getState().activeProjectId) {
        useToastStore.getState().addToast('warning', `"${button.label}" requires an active project`)
        return
      }
      try {
        await actionDef.execute()
      } catch (err: any) {
        useToastStore.getState().addToast('error', err.message)
      }
      return
    }

    const sessionState = useSessionStore.getState()
    const projectState = useProjectStore.getState()
    const activeSession = sessionState.sessions.find(
      (s) => s.id === sessionState.activeSessionId
    )
    const activeProject = projectState.projects.find(
      (p) => p.id === projectState.activeProjectId
    )

    const context = {
      branch: activeSession?.branchName,
      worktreePath: activeSession?.worktreePath,
      sessionName: activeSession?.name,
      repoPath: activeProject?.repoPath,
      projectName: activeProject?.name,
    }

    const resolvedCommand = resolveTemplateVars(button.command, context)
    const resolvedCwd = button.cwd
      ? resolveTemplateVars(button.cwd, context)
      : activeSession?.worktreePath ?? activeProject?.repoPath ?? '.'

    const sessionId = activeSession?.id ?? 'button-exec'

    try {
      const terminalId = await window.api.button.execute(
        resolvedCommand,
        resolvedCwd,
        button.actionType,
        button.executionMode,
        sessionId
      )

      // For claude action type in foreground mode, wait for the prompt before
      // writing the command (same pattern as review tabs).
      // Background claude buttons have the command piped in already.
      if (button.actionType === 'claude' && button.executionMode !== 'background') {
        let sent = false
        const unsub = window.api.terminal.onData((tid: string, data: string) => {
          if (tid !== terminalId || sent) return
          if (data.includes('>') || data.includes('$')) {
            sent = true
            unsub()
            setTimeout(() => {
              window.api.terminal.write(terminalId, resolvedCommand + '\r')
            }, 100)
          }
        })
        // Fallback timeout in case prompt detection misses
        setTimeout(() => {
          if (!sent) {
            sent = true
            unsub()
            window.api.terminal.write(terminalId, resolvedCommand + '\r')
          }
        }, 10000)
      }

      if (button.executionMode === 'background') {
        get().setButtonRunState(buttonId, { terminalId, running: true })

        // Listen for terminal exit to clear running state
        const cleanup = window.api.terminal.onExit((exitTermId, exitCode) => {
          if (exitTermId === terminalId) {
            get().setButtonRunState(buttonId, null)
            cleanup()
            if (exitCode === 0) {
              useToastStore.getState().addToast('success', `"${button.label}" completed`)
            } else {
              useToastStore.getState().addToast('error', `"${button.label}" failed (exit ${exitCode})`)
            }
          }
        })
      } else {
        // Terminal (foreground) mode: open a dynamic terminal tab in the workspace
        const { columns, addDynamicTab } = useWorkspaceLayoutStore.getState()
        const targetColumnId = columns[0]?.id
        if (targetColumnId) {
          const tabType = button.actionType === 'claude' ? 'agent' : 'terminal'
          const newTab = addDynamicTab(targetColumnId, tabType)
          // Register the already-spawned terminal so DynamicTerminalPanel uses it
          const sessionName = activeSession?.name ?? 'button'
          useTerminalStore.getState().registerDynamicTerminal(
            newTab, terminalId, sessionId, sessionName,
            button.actionType === 'claude' ? 'claude' : 'shell'
          )
        }
      }
    } catch (err: any) {
      useToastStore.getState().addToast('error', err.message)
    }
  },

  cancelButton: (buttonId) => {
    const runState = get().runningButtons[buttonId]
    if (!runState?.terminalId) return
    window.api.terminal.kill(runState.terminalId)
    get().setButtonRunState(buttonId, null)
    const button = get().buttons.find((b) => b.id === buttonId)
    useToastStore.getState().addToast('info', `"${button?.label ?? 'Button'}" cancelled`)
  },

  viewButtonOutput: (buttonId) => {
    const runState = get().runningButtons[buttonId]
    if (!runState?.terminalId) return

    const button = get().buttons.find((b) => b.id === buttonId)
    const sessionState = useSessionStore.getState()
    const activeSession = sessionState.sessions.find(
      (s) => s.id === sessionState.activeSessionId
    )
    const sessionId = activeSession?.id ?? 'button-exec'
    const sessionName = activeSession?.name ?? 'button'

    const { columns, addDynamicTab } = useWorkspaceLayoutStore.getState()
    const targetColumnId = columns[0]?.id
    if (targetColumnId) {
      const tabType = button?.actionType === 'claude' ? 'agent' : 'terminal'
      const newTab = addDynamicTab(targetColumnId, tabType)
      useTerminalStore.getState().registerDynamicTerminal(
        newTab, runState.terminalId, sessionId, sessionName,
        button?.actionType === 'claude' ? 'claude' : 'shell'
      )
    }
  },

  setButtonRunState: (buttonId, state) => {
    set((prev) => {
      const runningButtons = { ...prev.runningButtons }
      if (state) {
        runningButtons[buttonId] = state
      } else {
        delete runningButtons[buttonId]
      }
      return { runningButtons }
    })
  },

  getButtonsForPlacement: (placement, projectId) => {
    return get()
      .buttons.filter((b) => b.placement === placement && matchesScope(b, projectId))
      .sort((a, b) => a.order - b.order)
  },

  getGroupedButtons: (placement, projectId) => {
    const filtered = get().getButtonsForPlacement(placement, projectId)
    const groupsInPlacement = get()
      .groups.filter((g) => g.placement === placement && matchesScope(g, projectId))
      .sort((a, b) => a.order - b.order)

    const ungrouped = filtered
      .filter((b) => !b.groupId)
      .sort((a, b) => a.order - b.order)

    const groups = groupsInPlacement.map((group) => ({
      group,
      buttons: filtered
        .filter((b) => b.groupId === group.id)
        .sort((a, b) => a.order - b.order),
    }))

    return { ungrouped, groups }
  },
}))

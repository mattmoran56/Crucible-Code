import { BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type {
  CustomButton,
  CustomButtonGroup,
  ButtonActionType,
  ButtonExecutionMode,
} from '../../shared/types'
import * as terminalService from '../services/terminal.service'

const store = new Store<{
  buttons: CustomButton[]
  groups: CustomButtonGroup[]
}>({
  name: 'custom-buttons',
  defaults: { buttons: [], groups: [] },
})

export function registerButtonHandlers(window: BrowserWindow) {
  ipcMain.handle(IPC.BUTTON_LIST, async (): Promise<CustomButton[]> => {
    return store.get('buttons', [])
  })

  ipcMain.handle(IPC.BUTTON_SAVE, async (_e, buttons: CustomButton[]): Promise<void> => {
    store.set('buttons', buttons)
  })

  ipcMain.handle(IPC.BUTTON_GROUP_LIST, async (): Promise<CustomButtonGroup[]> => {
    return store.get('groups', [])
  })

  ipcMain.handle(IPC.BUTTON_GROUP_SAVE, async (_e, groups: CustomButtonGroup[]): Promise<void> => {
    store.set('groups', groups)
  })

  ipcMain.handle(
    IPC.BUTTON_EXECUTE,
    async (
      _e,
      resolvedCommand: string,
      cwd: string,
      actionType: ButtonActionType,
      executionMode: ButtonExecutionMode,
      sessionId: string
    ): Promise<string> => {
      if (executionMode === 'background') {
        // Background mode: spawn with the command baked into shell -l -c "cmd"
        // so the process exits when the command completes
        const mode = actionType === 'claude' ? 'claude' : 'command'
        const terminalId = terminalService.spawnTerminal(
          window, sessionId, cwd, mode,
          'dark', undefined,
          actionType === 'shell' ? resolvedCommand : undefined
        )

        // For claude background mode, the renderer will detect the prompt
        // and write the command (same pattern as review tabs)

        return terminalId
      }

      // Terminal (foreground) mode: spawn interactive shell and write command
      const mode = actionType === 'claude' ? 'claude' : 'shell'
      const terminalId = terminalService.spawnTerminal(window, sessionId, cwd, mode)

      // For shell commands, write after a short delay.
      // For claude commands, the renderer will detect the prompt
      // and write the command (same pattern as review tabs).
      if (actionType === 'shell') {
        setTimeout(() => {
          terminalService.writeTerminal(terminalId, resolvedCommand + '\n')
        }, 300)
      }

      return terminalId
    }
  )
}

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { ConfigTrackingMode } from '../../shared/types'
import * as configSync from '../services/config-sync.service'

export function registerConfigHandlers(window: BrowserWindow) {
  configSync.setWindow(window)

  ipcMain.handle(IPC.CONFIG_LIST, async (_e, repoPath: string) => {
    return configSync.discoverConfigItems(repoPath)
  })

  ipcMain.handle(IPC.CONFIG_GET_CONTENT, async (_e, repoPath: string, itemId: string) => {
    return configSync.getConfigContent(repoPath, itemId)
  })

  ipcMain.handle(
    IPC.CONFIG_SET_TRACKING,
    async (_e, repoPath: string, itemId: string, mode: ConfigTrackingMode) => {
      configSync.setTracking(repoPath, itemId, mode)
    }
  )

  ipcMain.handle(
    IPC.CONFIG_CREATE_COMMAND,
    async (_e, repoPath: string, name: string, content: string) => {
      return configSync.createCommand(repoPath, name, content)
    }
  )

  ipcMain.handle(
    IPC.CONFIG_CREATE_CLAUDEMD,
    async (_e, repoPath: string, location: 'root' | '.claude', content: string) => {
      return configSync.createClaudeMd(repoPath, location, content)
    }
  )

  ipcMain.handle(IPC.CONFIG_DELETE, async (_e, repoPath: string, itemId: string) => {
    configSync.deleteConfigItem(repoPath, itemId)
  })

  ipcMain.handle(
    IPC.CONFIG_UPDATE_CONTENT,
    async (_e, repoPath: string, itemId: string, content: string) => {
      configSync.updateConfigContent(repoPath, itemId, content)
    }
  )
}

import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { startUpdatePoller, stopUpdatePoller, applyUpdate, getBuiltCommit } from '../services/update.service'
import type { UpdateStatus } from '../../shared/types'

export function registerUpdateHandlers(window: BrowserWindow): void {
  startUpdatePoller((status: UpdateStatus) => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.UPDATE_STATUS, status)
    }
  })

  ipcMain.handle(IPC.UPDATE_APPLY, () => {
    applyUpdate(
      (line: string) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC.UPDATE_LOG, line)
        }
      },
      (status: UpdateStatus) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC.UPDATE_STATUS, status)
        }
      }
    )
    return getBuiltCommit()
  })

  ipcMain.handle(IPC.UPDATE_BUILT_COMMIT, () => getBuiltCommit())
}

export function unregisterUpdateHandlers(): void {
  stopUpdatePoller()
}

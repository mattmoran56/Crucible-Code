import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { startUpdatePoller, stopUpdatePoller, applyUpdate } from '../services/update.service'
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
  })
}

export function unregisterUpdateHandlers(): void {
  stopUpdatePoller()
}

import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import * as usageService from '../services/usage.service'

export function registerUsageHandlers(window: BrowserWindow) {
  // Start polling session usage files
  usageService.startUsagePolling(window)

  ipcMain.handle(IPC.USAGE_GET_SESSION, async (_e, sessionId: string) => {
    return usageService.getSessionUsage(sessionId)
  })

  ipcMain.handle(IPC.USAGE_GET_STATS, async () => {
    return usageService.getUsageStats()
  })

  ipcMain.handle(IPC.USAGE_GET_SUBSCRIPTION, async () => {
    return usageService.getSubscriptionInfo()
  })
}

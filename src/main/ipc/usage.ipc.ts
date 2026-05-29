import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import * as usageService from '../services/usage.service'

export function registerUsageHandlers(window: BrowserWindow) {
  // Start polling session usage files
  usageService.startUsagePolling(window)

  handle(IPC.USAGE_GET_SESSION, async (_e, sessionId: string) => {
    return usageService.getSessionUsage(sessionId)
  })

  handle(IPC.USAGE_GET_STATS, async (_e, configDir?: string) => {
    return usageService.getUsageStats(configDir)
  })

  handle(IPC.USAGE_GET_SUBSCRIPTION, async (_e, configDir?: string) => {
    return usageService.getSubscriptionInfo(configDir)
  })
}

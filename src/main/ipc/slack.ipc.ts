import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import {
  loadSlackConfig,
  saveSlackConfig,
  getMaskedConfig,
  type SlackConfig,
} from '../services/slack-config.service'
import {
  startSlack,
  stopSlack,
  isConnected,
  sendTestMessage,
} from '../services/slack.service'

export function registerSlackHandlers() {
  ipcMain.handle(IPC.SLACK_SAVE_CONFIG, async (_e, incoming: Partial<SlackConfig>) => {
    // Merge with existing config — empty token strings mean "keep existing"
    const existing = loadSlackConfig()
    const merged: SlackConfig = {
      enabled: incoming.enabled ?? existing.enabled,
      botToken: incoming.botToken || existing.botToken,
      appToken: incoming.appToken || existing.appToken,
      channelId: incoming.channelId ?? existing.channelId,
    }
    saveSlackConfig(merged)

    // Auto-connect or disconnect based on enabled state
    if (merged.enabled && merged.botToken && merged.appToken && merged.channelId) {
      try {
        await startSlack(merged.botToken, merged.appToken, merged.channelId)
        return { ok: true }
      } catch (err: any) {
        return { ok: false, error: err.message }
      }
    } else {
      await stopSlack()
      return { ok: true }
    }
  })

  ipcMain.handle(IPC.SLACK_LOAD_CONFIG, async () => {
    return getMaskedConfig()
  })

  ipcMain.handle(IPC.SLACK_CONNECT, async () => {
    const config = loadSlackConfig()
    if (!config.botToken || !config.appToken || !config.channelId) {
      throw new Error('Slack configuration is incomplete')
    }
    await startSlack(config.botToken, config.appToken, config.channelId)
  })

  ipcMain.handle(IPC.SLACK_DISCONNECT, async () => {
    await stopSlack()
  })

  ipcMain.handle(IPC.SLACK_STATUS, async () => {
    return { connected: isConnected() }
  })

  ipcMain.handle(IPC.SLACK_TEST, async () => {
    await sendTestMessage()
  })
}

/** Auto-connect Slack on app startup if enabled */
export async function initSlackOnStartup(): Promise<void> {
  const config = loadSlackConfig()
  if (config.enabled && config.botToken && config.appToken && config.channelId) {
    try {
      await startSlack(config.botToken, config.appToken, config.channelId)
      console.log('Slack auto-connected on startup')
    } catch (err) {
      console.error('Slack auto-connect failed:', err)
    }
  }
}

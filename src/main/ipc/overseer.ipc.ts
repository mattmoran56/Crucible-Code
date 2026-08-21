import type { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { OverseerSettings } from '../../shared/types'
import * as overseer from '../services/overseer.service'

export function registerOverseerHandlers(window: BrowserWindow) {
  overseer.installOverseer(window)

  handle(IPC.OVERSEER_STATE_GET, async () => overseer.getState())

  handle(IPC.OVERSEER_SEND, async (_e, text: string) => {
    // Deliberately not awaited: a pass can run for a while and the renderer
    // follows along through OVERSEER_STATE_UPDATE rather than a return value.
    void overseer.sendUserMessage(text)
  })

  handle(IPC.OVERSEER_CANCEL, async () => overseer.cancel())

  handle(IPC.OVERSEER_CLEAR, async () => overseer.clearConversation())

  handle(IPC.OVERSEER_SETTINGS_GET, async () => overseer.getSettings())

  handle(IPC.OVERSEER_SETTINGS_SET, async (_e, settings: Partial<OverseerSettings>) =>
    overseer.setSettings(settings)
  )

  handle(IPC.OVERSEER_MARK_READ, async () => overseer.markRead())

  handle(IPC.OVERSEER_HEARTBEAT_NOW, async () => {
    void overseer.heartbeatTick(true)
  })
}

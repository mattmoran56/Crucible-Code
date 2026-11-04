import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import type { SessionDispatchResponse } from '../../shared/session-dispatch'
import { resolveDispatchRequest, setDispatchSender } from '../services/session-dispatch.service'

/**
 * Bridge between the `crucible` MCP server and the renderer, which creates
 * sessions. Requests go to one window (a primary-only channel, see
 * window-manager.service) so a session is never created once per window.
 *
 * The answer uses ipcMain.handle directly rather than `handle`, so the relay
 * bridge (paired remote devices) cannot answer an agent's tool call.
 */
export function registerSessionDispatchHandlers(window: BrowserWindow): void {
  setDispatchSender((req) => {
    if (BrowserWindow.getAllWindows().every((w) => w.isDestroyed())) return false
    window.webContents.send(IPC.SESSION_DISPATCH_REQUEST, req)
    return true
  })

  ipcMain.handle(IPC.SESSION_DISPATCH_RESPOND, (_e, id: string, response: SessionDispatchResponse) => {
    if (typeof id !== 'string' || !response || typeof response !== 'object') return
    resolveDispatchRequest(id, response)
  })
}

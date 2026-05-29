import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import {
  getRemoteStatus,
  setRemoteEnabled,
  startRelayServer,
  stopRelayServer,
  regeneratePairingCode,
  isRelayRunning,
  type RemoteStatus,
} from '../../../remote/server/relay-server'
import { revokeAll } from '../../../remote/server/auth'

export function registerRemoteHandlers(window: BrowserWindow) {
  const pushStatus = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.REMOTE_STATUS_CHANGED, getRemoteStatus())
    }
  }

  handle(IPC.REMOTE_GET_STATUS, async (): Promise<RemoteStatus> => {
    return getRemoteStatus()
  })

  handle(IPC.REMOTE_SET_ENABLED, async (_e, enabled: boolean): Promise<RemoteStatus> => {
    setRemoteEnabled(enabled)
    if (enabled && !isRelayRunning()) {
      await startRelayServer()
    } else if (!enabled && isRelayRunning()) {
      stopRelayServer()
    }
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  handle(IPC.REMOTE_REGENERATE_CODE, async (): Promise<RemoteStatus> => {
    regeneratePairingCode()
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  handle(IPC.REMOTE_REVOKE_ALL, async (): Promise<RemoteStatus> => {
    revokeAll()
    const status = getRemoteStatus()
    pushStatus()
    return status
  })
}

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
import {
  isCloudEnabled,
  setCloudEnabled,
  startCloudClient,
  stopCloudClient,
  regenerateCloudHandle,
  setCloudStatusListener,
  refreshPhoneTicketForNewCode,
} from '../../../remote/server/cloud-client'
import {
  generatePairingCode,
  currentPairingCode,
  setPairingMode,
  type PairingMode,
} from '../../../remote/server/pairing'
import {
  setRequireApproval,
  approvePairing,
  denyPairing,
  setApprovalChangeListener,
  listPendingPairings,
} from '../../../remote/server/approval'

export function registerRemoteHandlers(window: BrowserWindow) {
  const pushStatus = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC.REMOTE_STATUS_CHANGED, getRemoteStatus())
    }
  }

  // Cloud client pushes status changes too (connection, safety number, etc.)
  setCloudStatusListener(pushStatus)

  // Approval gate pushes status (pendingPairings) and a discrete event so the
  // popover can flash open / play a sound when a new request arrives.
  setApprovalChangeListener(() => {
    if (window.isDestroyed()) return
    const pending = listPendingPairings()
    window.webContents.send(IPC.REMOTE_PAIRING_REQUESTED, pending)
    pushStatus()
  })

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
    // Cloud ticket is derived from (handle, code); update the Worker's DO
    // so a phone using the new code derives the matching ticket.
    await refreshPhoneTicketForNewCode()
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

  handle(IPC.REMOTE_SET_CLOUD_ENABLED, async (_e, enabled: boolean): Promise<RemoteStatus> => {
    setCloudEnabled(enabled)
    if (enabled) {
      // Cloud pair mode needs an active pairing code; mint one if there isn't
      // one already (LAN relay would normally do this on start).
      if (!currentPairingCode()) generatePairingCode()
      try {
        await startCloudClient()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[cloud] startCloudClient failed: ${err instanceof Error ? err.message : String(err)}`)
        // Flip cloud back off so the toggle UI matches reality.
        setCloudEnabled(false)
        stopCloudClient()
        pushStatus()
        throw err
      }
    } else {
      stopCloudClient()
    }
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  handle(IPC.REMOTE_SET_REQUIRE_APPROVAL, async (_e, enabled: boolean): Promise<RemoteStatus> => {
    setRequireApproval(enabled)
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  handle(IPC.REMOTE_APPROVE_PAIRING, async (_e, id: string): Promise<RemoteStatus> => {
    approvePairing(id)
    return getRemoteStatus()
  })

  handle(IPC.REMOTE_DENY_PAIRING, async (_e, id: string): Promise<RemoteStatus> => {
    denyPairing(id)
    return getRemoteStatus()
  })

  handle(IPC.REMOTE_SET_PAIRING_MODE, async (_e, mode: PairingMode): Promise<RemoteStatus> => {
    setPairingMode(mode)
    // setPairingMode mints a fresh secret in the new mode; push the new ticket
    // to the relay so cloud-mode phones using the new secret still connect.
    await refreshPhoneTicketForNewCode()
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  handle(IPC.REMOTE_REGENERATE_HANDLE, async (): Promise<RemoteStatus> => {
    await regenerateCloudHandle()
    const status = getRemoteStatus()
    pushStatus()
    return status
  })

  // Auto-start cloud if it was on last session.
  if (isCloudEnabled()) {
    if (!currentPairingCode()) generatePairingCode()
    void startCloudClient()
  }
}

import { ipcMain } from 'electron'
import { IPC } from '../../shared/constants'
import { getSharedPermissions, updateSharedPermissions } from '../services/permission-sync.service'

export function registerPermissionsHandlers() {
  ipcMain.handle(IPC.PERMISSIONS_GET, async (_e, repoPath: string) => {
    return getSharedPermissions(repoPath)
  })

  ipcMain.handle(
    IPC.PERMISSIONS_UPDATE,
    async (_e, repoPath: string, permissions: { allow: string[]; deny: string[] }) => {
      updateSharedPermissions(repoPath, permissions)
    }
  )
}

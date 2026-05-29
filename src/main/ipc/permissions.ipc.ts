import { IPC } from '../../shared/constants'
import { handle } from './handle'
import { getSharedPermissions, updateSharedPermissions } from '../services/permission-sync.service'

export function registerPermissionsHandlers() {
  handle(IPC.PERMISSIONS_GET, async (_e, repoPath: string) => {
    return getSharedPermissions(repoPath)
  })

  handle(
    IPC.PERMISSIONS_UPDATE,
    async (_e, repoPath: string, permissions: { allow: string[]; deny: string[] }) => {
      updateSharedPermissions(repoPath, permissions)
    }
  )
}

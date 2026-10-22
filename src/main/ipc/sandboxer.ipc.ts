import { shell } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { SandboxInfo } from '../../shared/types'
import * as sandboxerService from '../services/sandboxer.service'

export function registerSandboxerHandlers() {
  handle(IPC.SANDBOXER_CHECK_CONFIG, async (_e, repoPath: string, configPath?: string) => {
    return sandboxerService.checkConfig(repoPath, configPath)
  })

  handle(
    IPC.SANDBOXER_PREPARE,
    async (_e, repoPath: string, worktreePath: string, configPath?: string) => {
      return sandboxerService.prepareWorktree(repoPath, worktreePath, configPath)
    }
  )

  handle(IPC.SANDBOXER_STATUS, async (_e, worktreePath: string) => {
    return sandboxerService.status(worktreePath)
  })

  handle(IPC.SANDBOXER_STOP, async (_e, sandbox: SandboxInfo) => {
    return sandboxerService.stop(sandbox)
  })

  handle(IPC.SANDBOXER_START, async (_e, sandbox: SandboxInfo) => {
    return sandboxerService.start(sandbox)
  })

  handle(IPC.SANDBOXER_DOWN, async (_e, worktreePath: string) => {
    return sandboxerService.teardownForWorktree(worktreePath)
  })

  handle(IPC.SANDBOXER_OPEN_URL, async (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error(`Not a sandbox URL: ${url}`)
    await shell.openExternal(url)
  })
}

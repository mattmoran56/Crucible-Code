import { shell, type BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { SandboxInfo } from '../../shared/types'
import * as sandboxerService from '../services/sandboxer.service'
import * as jobs from '../services/sandboxer-jobs.service'

export function registerSandboxerHandlers(window: BrowserWindow) {
  handle(IPC.SANDBOXER_CHECK_CONFIG, async (_e, repoPath: string, configPath?: string) => {
    return sandboxerService.checkConfig(repoPath, configPath)
  })

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
    // An `up` still running would bring the sandbox straight back.
    jobs.cancelJob(worktreePath)
    return sandboxerService.teardownForWorktree(worktreePath)
  })

  handle(
    IPC.SANDBOXER_UP,
    async (_e, repoPath: string, worktreePath: string, configPath?: string) => {
      await sandboxerService.prepareWorktree(repoPath, worktreePath, configPath)
      return jobs.startJob(window, worktreePath, 'Starting sandbox', ['up'])
    }
  )

  handle(IPC.SANDBOXER_BUILD, async (_e, sandbox: SandboxInfo, label: string) => {
    return jobs.startJob(window, sandbox.worktree, `Building ${label}`, [
      'reload',
      sandbox.slug,
      '--project',
      sandbox.project,
      '--web',
      label,
    ])
  })

  handle(IPC.SANDBOXER_JOB_GET, async (_e, worktreePath: string) => {
    return jobs.getJob(worktreePath)
  })

  handle(IPC.SANDBOXER_JOB_CANCEL, async (_e, worktreePath: string) => {
    jobs.cancelJob(worktreePath)
  })

  handle(IPC.SANDBOXER_OPEN_URL, async (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error(`Not a sandbox URL: ${url}`)
    await shell.openExternal(url)
  })
}

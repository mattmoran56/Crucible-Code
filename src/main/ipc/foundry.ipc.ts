import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type {
  FoundryConfig,
  FoundryPipelineAction,
  FoundryRuntimeState,
  FoundryTaskStartedAck,
  FoundryWorkerPermissionMode,
} from '../../shared/types'
import * as foundry from '../services/foundry.service'
import { installForeman } from '../services/foundry-foreman.service'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import { seedPermissions, startWatching } from '../services/permission-sync.service'

const PERMISSION_MODE_ARGS: Record<FoundryWorkerPermissionMode, string[]> = {
  bypassPermissions: ['--dangerously-skip-permissions'],
  acceptEdits: ['--permission-mode', 'acceptEdits'],
  default: [],
}

export function registerFoundryHandlers(window: BrowserWindow): void {
  installForeman()
  foundry.startFoundryService(window)

  handle(IPC.FOUNDRY_LIST, async (): Promise<FoundryConfig[]> => foundry.listConfigs())

  handle(IPC.FOUNDRY_SAVE, async (_e, cfg: FoundryConfig): Promise<FoundryConfig[]> => {
    foundry.saveConfig(cfg)
    return foundry.listConfigs()
  })

  handle(IPC.FOUNDRY_DELETE, async (_e, foundryId: string): Promise<FoundryConfig[]> => {
    return foundry.deleteConfig(foundryId)
  })

  handle(IPC.FOUNDRY_SET_PAUSED, async (_e, foundryId: string, paused: boolean): Promise<void> => {
    foundry.setPaused(foundryId, paused)
  })

  handle(IPC.FOUNDRY_RUN_NOW, async (_e, foundryId: string): Promise<void> => {
    foundry.runPassNow(foundryId)
  })

  handle(IPC.FOUNDRY_STATE_GET, async (_e, foundryId: string): Promise<FoundryRuntimeState | null> => {
    return foundry.getState(foundryId)
  })

  handle(IPC.FOUNDRY_TASK_STARTED, async (_e, foundryId: string, ack: FoundryTaskStartedAck): Promise<void> => {
    foundry.ackTaskStarted(foundryId, ack)
  })

  handle(
    IPC.FOUNDRY_PIPELINE_ACTION,
    async (_e, foundryId: string, pipelineId: string, action: FoundryPipelineAction): Promise<void> => {
      foundry.pipelineAction(foundryId, pipelineId, action)
    }
  )

  handle(
    IPC.FOUNDRY_SPAWN_WORKER,
    async (
      _e,
      sessionId: string,
      cwd: string,
      prompt: string,
      claudeTheme: string,
      claudeConfigDir: string | undefined,
      repoPath: string | undefined,
      contextId: string,
      tabId: string,
      permissionMode: FoundryWorkerPermissionMode
    ): Promise<string> => {
      writeClaudeHookSettings(cwd, claudeTheme, sessionId)
      if (repoPath) {
        seedPermissions(repoPath, cwd)
        startWatching(repoPath, cwd)
      }
      const claudeArgs = PERMISSION_MODE_ARGS[permissionMode] ?? PERMISSION_MODE_ARGS.bypassPermissions
      return terminalService.spawnTerminal(
        window,
        sessionId,
        cwd,
        'claude',
        claudeTheme,
        claudeConfigDir,
        prompt,
        repoPath,
        false,
        contextId,
        tabId,
        claudeArgs
      )
    }
  )

  handle(IPC.FOUNDRY_OPEN_FOREMAN, async (_e, _foundryId: string): Promise<void> => {
    // Stub: M3 implements the embedded foreman terminal. The renderer can
    // already show the captured transcript; resuming requires the foreman
    // module to expose its last claudeSessionId.
  })
}

export function shutdownFoundry(): void {
  foundry.stopFoundryService()
}

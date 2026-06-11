import Store from 'electron-store'
import { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type {
  FoundryConfig,
  FoundryPipelineAction,
  FoundryRuntimeState,
  FoundryTaskStartedAck,
  FoundryWorkerPermissionMode,
  Project,
} from '../../shared/types'
import * as foundry from '../services/foundry.service'
import { installForeman } from '../services/foundry-foreman.service'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import { seedPermissions, startWatching } from '../services/permission-sync.service'
import { getStorePath } from '../store-path'

// Worker permission args. We DELIBERATELY never pass
// `--dangerously-skip-permissions` — the user's global claude config
// (auto-accept, allow/deny lists) is the source of truth. Forcing
// bypass would silently override their preferred posture.
//
// The `bypassPermissions` entry is kept for backward-compatibility with
// existing stored configs (they used to default to it), but it now resolves
// to no args — same as `default`. The picker has been removed from the UI.
const PERMISSION_MODE_ARGS: Record<FoundryWorkerPermissionMode, string[]> = {
  bypassPermissions: [],
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

  handle(
    IPC.FOUNDRY_RESET_STATE,
    async (_e, foundryId: string): Promise<{ ok: boolean; reason?: string }> => {
      return foundry.resetState(foundryId)
    }
  )

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

  handle(
    IPC.FOUNDRY_OPEN_FOREMAN,
    async (_e, foundryId: string): Promise<{ terminalId: string; contextId: string } | null> => {
      const state = foundry.getState(foundryId)
      const configs = foundry.listConfigs()
      const cfg = configs.find((c) => c.id === foundryId)
      if (!cfg) return null
      // Find the project's repo path — foreman uses it as its cwd so it can
      // read the codebase when reasoning about dependencies.
      // Match project.ipc.ts — no `name`, so this reads from electron-store's
      // default `config.json` (where the project IPC handler persists them).
      const projectsStore = new Store<{ projects: Project[] }>({
        cwd: getStorePath(),
        defaults: { projects: [] },
      })
      const project = projectsStore.get('projects', []).find((p) => p.id === cfg.projectId)
      if (!project?.repoPath) return null

      // claude --resume <sessionId>  — passed via claudeArgs so we get exactly
      // the foreman conversation, not a fresh session. If the foreman hasn't
      // run yet (no captured session id), open a plain `claude` instead so
      // the user can prime it manually.
      const sessionId = state?.foremanClaudeSessionId
      const claudeArgs = sessionId ? ['--resume', sessionId] : []

      const contextId = `foundry-foreman-${foundryId}`
      const tabId = 'foreman'
      const terminalId = terminalService.spawnTerminal(
        window,
        contextId,
        project.repoPath,
        'claude',
        'dark',
        undefined, // claude config dir — inherit project default via env
        undefined, // no commandString — the user will type into the PTY
        project.repoPath,
        false, // not a resume from terminal.service's perspective; we pass --resume via claudeArgs
        contextId,
        tabId,
        claudeArgs
      )
      return { terminalId, contextId }
    }
  )
}

export function shutdownFoundry(): void {
  foundry.stopFoundryService()
}

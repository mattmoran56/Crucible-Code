import { BrowserWindow, shell } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { CloudSessionResult, CloudTeleportResult } from '../../shared/types'
import * as terminalService from '../services/terminal.service'
import { writeClaudeHookSettings } from '../services/hook.service'
import {
  claudeShellCommand,
  createCloudSession,
  discoverTeleportedSession,
  isCloudSessionUrl,
  sendCloudMessage,
  teleportArgv,
  worktreeDirtyFiles,
  type CreateCloudSessionOptions,
  type DiscoverOptions,
  type SendCloudMessageOptions,
} from '../services/cloud-session.service'

/** What the renderer passes to put a cloud session's PTY in a session's Agent tab. */
export interface CloudPtyOptions {
  /** App session id (the PTY's owner and hook context). */
  sessionId: string
  worktreePath: string
  cloudSessionId: string
  configDir?: string | null
  repoPath?: string
  claudeTheme?: string
}

/** The Agent tab id the teleport PTY reports under, so tab status lands on Agent. */
export const CLOUD_PTY_TAB = 'agent'

function spawnCloudPty(window: BrowserWindow, opts: CloudPtyOptions, argv: string[]): string {
  // Only one cloud PTY per session tab (a retried teleport replaces a dead
  // one). spawnTerminal is idempotent per tab.
  terminalService.killTerminalsForTab(opts.sessionId, CLOUD_PTY_TAB)
  return terminalService.spawnTerminal(
    window,
    opts.sessionId,
    opts.worktreePath,
    'command',
    opts.claudeTheme ?? 'dark',
    opts.configDir ?? undefined,
    claudeShellCommand(argv),
    opts.repoPath,
    false,
    opts.sessionId,
    CLOUD_PTY_TAB
  )
}

export function registerCloudSessionHandlers(window: BrowserWindow): void {
  handle(IPC.CLOUD_SESSION_CREATE, async (_e, opts: CreateCloudSessionOptions): Promise<CloudSessionResult> =>
    createCloudSession(opts)
  )

  handle(IPC.CLOUD_SESSION_SEND, async (_e, opts: SendCloudMessageOptions): Promise<CloudSessionResult> =>
    sendCloudMessage(opts)
  )

  handle(IPC.CLOUD_SESSION_TELEPORT, async (_e, opts: CloudPtyOptions): Promise<CloudTeleportResult> => {
    // Validate the id before touching anything.
    const argv = teleportArgv(opts.cloudSessionId)
    // Teleport needs a clean tree. Never stash on the user's behalf — report
    // what is in the way and let them decide.
    const files = await worktreeDirtyFiles(opts.worktreePath)
    if (files.length > 0) return { ok: false, reason: 'dirty', files }
    // The teleported session is a normal local Claude session from here on,
    // so give it the same hook settings every local agent gets.
    writeClaudeHookSettings(opts.worktreePath, opts.claudeTheme ?? 'dark', opts.sessionId)
    return { ok: true, terminalId: spawnCloudPty(window, opts, argv) }
  })

  handle(IPC.CLOUD_SESSION_DISCOVER_LOCAL, async (_e, opts: DiscoverOptions): Promise<string | null> =>
    discoverTeleportedSession(opts)
  )

  handle(IPC.CLOUD_SESSION_OPEN_URL, async (_e, url: string): Promise<void> => {
    if (!isCloudSessionUrl(url)) throw new Error('Refusing to open a non-claude.ai URL')
    await shell.openExternal(url)
  })
}

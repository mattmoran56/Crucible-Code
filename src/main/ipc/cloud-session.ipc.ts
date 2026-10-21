import { BrowserWindow, shell } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { CloudCreateState, CloudSessionResult, CloudTeleportResult, CloudTeleportState } from '../../shared/types'
import { writeClaudeHookSettings } from '../services/hook.service'
import {
  CLOUD_PTY_TAB,
  getCloudCreateState,
  startCloudCreate,
  type StartCloudCreateOptions,
} from '../services/cloud-create.service'
import { finishTeleport, getTeleportState, startTeleport } from '../services/cloud-teleport.service'
import {
  discoverTeleportedSession,
  isCloudSessionUrl,
  sendCloudMessage,
  teleportArgv,
  worktreeDirtyFiles,
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

/** The Agent tab id cloud PTYs report under, so tab status lands on Agent. */
export { CLOUD_PTY_TAB }

export function registerCloudSessionHandlers(window: BrowserWindow): void {
  // Creating a cloud session is interactive: push the branch, then run
  // `claude --cloud <task>` in a PTY in the Agent tab (see cloud-create.service).
  handle(IPC.CLOUD_SESSION_START, async (_e, opts: StartCloudCreateOptions): Promise<CloudCreateState> =>
    startCloudCreate(window, opts)
  )

  handle(IPC.CLOUD_SESSION_CREATE_STATE, async (_e, sessionId: string): Promise<CloudCreateState | null> =>
    getCloudCreateState(sessionId)
  )

  handle(IPC.CLOUD_SESSION_SEND, async (_e, opts: SendCloudMessageOptions): Promise<CloudSessionResult> =>
    sendCloudMessage(opts)
  )

  handle(IPC.CLOUD_SESSION_TELEPORT, async (_e, opts: CloudPtyOptions): Promise<CloudTeleportResult> => {
    // Validate the id before touching anything.
    teleportArgv(opts.cloudSessionId)
    // Teleport needs a clean tree. Never stash on the user's behalf — report
    // what is in the way and let them decide.
    const files = await worktreeDirtyFiles(opts.worktreePath)
    if (files.length > 0) return { ok: false, reason: 'dirty', files }
    // The teleported session is a normal local Claude session from here on,
    // so give it the same hook settings every local agent gets.
    writeClaudeHookSettings(opts.worktreePath, opts.claudeTheme ?? 'dark', opts.sessionId)
    // The PTY is watched until the conversation is local, then closed so the
    // Agent tab can resume it as a visual agent (see cloud-teleport.service).
    const state = startTeleport(window, opts)
    return { ok: true, terminalId: state.terminalId, state }
  })

  handle(IPC.CLOUD_SESSION_TELEPORT_STATE, async (_e, sessionId: string): Promise<CloudTeleportState | null> =>
    getTeleportState(sessionId)
  )

  handle(IPC.CLOUD_SESSION_TELEPORT_FINISH, async (_e, sessionId: string): Promise<CloudTeleportState | null> =>
    finishTeleport(sessionId)
  )

  handle(IPC.CLOUD_SESSION_DISCOVER_LOCAL, async (_e, opts: DiscoverOptions): Promise<string | null> =>
    discoverTeleportedSession(opts)
  )

  handle(IPC.CLOUD_SESSION_OPEN_URL, async (_e, url: string): Promise<void> => {
    if (!isCloudSessionUrl(url)) throw new Error('Refusing to open a non-claude.ai URL')
    await shell.openExternal(url)
  })
}

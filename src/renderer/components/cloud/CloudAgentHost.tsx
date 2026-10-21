// Drives a cloud session's Agent tab: creates the cloud session (a visible
// `claude --cloud <task>` terminal the user can answer), then shows the
// claude.ai/code session page embedded, and teleports the session down to the
// worktree on request.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { CloudCreateState } from '../../../shared/types'
import { applyCloudCreated } from '../../lib/cloudCreate'
import { applyTeleportState } from '../../lib/cloudTeleport'
import { projectConfigDir } from '../../lib/visualAgents'
import { branchMismatchToast, reconcileTeleportBranch } from '../../lib/teleportBranch'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useToastStore } from '../../stores/toastStore'
import { destroyTerminal } from '../terminal/useTerminal'
import { CloudAgentPanel, type CloudAgentPhase } from './CloudAgentPanel'

/** The Agent tab id the teleport PTY reports under (matches the main process). */
const AGENT_TAB = 'agent'

/** How often, and for how long, to look for the branch a teleport checks out. */
export const BRANCH_POLL_MS = 3_000
export const BRANCH_POLL_WINDOW_MS = 2 * 60_000

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Where the user lists their cloud sessions (a create may have gone through unseen). */
export const CLAUDE_CODE_HOME = 'https://claude.ai/code'

/** Which create phase a pending session is in, from its run (or the lack of one). */
export function createPhaseFor(run: CloudCreateState | null, starting: boolean): CloudAgentPhase {
  if (!run) return starting ? 'creating' : 'create-interrupted'
  return run.status === 'failed' ? 'create-failed' : 'creating'
}

export function CloudAgentHost({
  sessionId,
  visible,
  embedWebview,
}: {
  sessionId: string
  visible: boolean
  /** Passed through to the panel (tests/stories). */
  embedWebview?: boolean
}) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session?.projectId))
  const accounts = useProjectStore((s) => s.claudeAccounts)
  const teleportTerminal = useCloudSessionStore((s) => s.teleports[sessionId] ?? null)
  const teleportRun = useCloudSessionStore((s) => {
    const run = s.teleportRuns[sessionId]
    return run && run.terminalId === s.teleports[sessionId] ? run : null
  })
  const branchNotice = useCloudSessionStore((s) => s.branchNotices[sessionId] ?? null)

  const [phase, setPhase] = useState<CloudAgentPhase>(teleportTerminal ? 'teleported' : 'web')
  const [error, setError] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([])

  const cloud = session?.cloud
  const pending = !!session?.cloudPending && !cloud
  const createRun = useCloudSessionStore((s) => s.creates[sessionId] ?? null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  /** After creation: show the still-attached local CLI instead of the page. */
  const [showCli, setShowCli] = useState(false)
  const createTerminal = createRun?.terminalId ?? null
  const cliAttached = !!createRun?.attached && !!createTerminal

  const register = useCallback(
    (terminalId: string) => {
      useTerminalStore
        .getState()
        .registerDynamicTerminal(AGENT_TAB, terminalId, sessionId, session?.name ?? sessionId, 'claude', sessionId)
    },
    [sessionId, session?.name]
  )

  // Every create PTY goes into the terminal store so the Agent tab's status
  // (and the TerminalView) follow it.
  useEffect(() => {
    if (createTerminal) register(createTerminal)
  }, [createTerminal, register])

  const startCreate = useCallback(async () => {
    const current = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
    const pendingLink = current?.cloudPending
    if (!current || !pendingLink || current.cloud) return
    setStarting(true)
    setStartError(null)
    try {
      const state = await window.api.cloudSession.start({
        sessionId: current.id,
        projectId: current.projectId,
        worktreePath: current.worktreePath,
        branch: pendingLink.branch,
        task: pendingLink.task,
        configDir: projectConfigDir(project, accounts),
        repoPath: project?.repoPath,
        claudeTheme: useSettingsStore.getState().claudeTheme,
      })
      // An event may already have moved the run on (session found quickly).
      const known = useCloudSessionStore.getState().creates[sessionId]
      if (!known || known.terminalId !== state.terminalId || state.status === 'failed') {
        useCloudSessionStore.getState().setCreate(state)
      }
    } catch (err) {
      setStartError(`Couldn't start the cloud session: ${message(err)}`)
    } finally {
      setStarting(false)
    }
  }, [sessionId, project, accounts])

  // A pending session: pick up a run already going in the main process (the
  // tab was remounted), start one if this session was just created, else
  // (app restarted mid-create) wait for the user — re-running the CLI on its
  // own could create a second cloud session.
  const checkedRun = useRef(false)
  useEffect(() => {
    if (!pending || checkedRun.current) return
    checkedRun.current = true
    void (async () => {
      let run: CloudCreateState | null = useCloudSessionStore.getState().creates[sessionId] ?? null
      if (!run) {
        try {
          run = (await window.api.cloudSession.createState?.(sessionId)) ?? null
        } catch {
          run = null
        }
        if (run) useCloudSessionStore.getState().setCreate(run)
      }
      if (run) {
        void applyCloudCreated(run)
        return
      }
      if (useCloudSessionStore.getState().consumeAutoStart(sessionId)) void startCreate()
    })()
  }, [pending, sessionId, startCreate])

  const closeCli = useCallback(() => {
    if (!createTerminal) return
    // The CLI says detaching leaves the cloud session running.
    void window.api.terminal.kill(createTerminal)
    setShowCli(false)
  }, [createTerminal])

  const openCloudHome = useCallback(() => {
    void window.api.cloudSession.openUrl(CLAUDE_CODE_HOME)
  }, [])

  const deleteSession = useCallback(async () => {
    const current = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
    if (!current || !project) return
    await useSessionStore.getState().removeSession(current.projectId, project.repoPath, current.id, { deleteRemoteBranch: true })
  }, [sessionId, project])

  // Once teleported: notice when the local session exits, and check which
  // branch the teleport checked out (it does so early, so poll briefly, and
  // once more on exit).
  useEffect(() => {
    if (!teleportTerminal) return
    let done = false
    const check = async () => {
      if (done) return
      const current = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
      if (!current) return
      const mismatch = await reconcileTeleportBranch(current)
      if (mismatch && !done) {
        done = true
        useCloudSessionStore.getState().setBranchNotice(sessionId, mismatch)
        useToastStore.getState().addToast('info', branchMismatchToast(current.name, mismatch))
      }
    }
    const timer = setInterval(() => void check(), BRANCH_POLL_MS)
    const stop = setTimeout(() => clearInterval(timer), BRANCH_POLL_WINDOW_MS)
    const offExit = window.api.terminal.onExit((id) => {
      if (id !== teleportTerminal) return
      void check()
    })
    return () => {
      done = true
      clearInterval(timer)
      clearTimeout(stop)
      offExit?.()
    }
  }, [teleportTerminal, sessionId])

  // The run lives in the main process; pick it up if this tab was remounted
  // (events only carry changes).
  useEffect(() => {
    if (!teleportTerminal || teleportRun) return
    let cancelled = false
    void window.api.cloudSession
      .teleportState?.(sessionId)
      .then((state) => {
        if (!cancelled && state && state.terminalId === teleportTerminal) useCloudSessionStore.getState().setTeleportRun(state)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [teleportTerminal, teleportRun, sessionId])

  // Done: the conversation is local — resume it as a visual agent (the app-level
  // listener normally gets there first; this is idempotent).
  useEffect(() => {
    if (teleportRun?.status === 'done') void applyTeleportState(teleportRun)
  }, [teleportRun])

  const finishTeleport = useCallback(() => {
    void window.api.cloudSession.finishTeleport?.(sessionId)
  }, [sessionId])

  const teleport = useCallback(async () => {
    if (!session?.cloud) return
    const link = session.cloud
    setPhase('teleport-checking')
    setDirtyFiles([])
    setError(null)
    try {
      const result = await window.api.cloudSession.teleport({
        sessionId: session.id,
        projectId: session.projectId,
        worktreePath: session.worktreePath,
        cloudSessionId: link.sessionId,
        configDir: projectConfigDir(project, accounts),
        repoPath: project?.repoPath,
        claudeTheme: useSettingsStore.getState().claudeTheme,
      })
      if (!result.ok) {
        setDirtyFiles(result.files)
        setPhase('teleport-blocked')
        return
      }
      register(result.terminalId)
      // Keep this tab on the teleport view until the conversation is local,
      // even though the session is local from now on.
      if (result.state) useCloudSessionStore.getState().setTeleportRun(result.state)
      useCloudSessionStore.getState().setTeleport(session.id, result.terminalId)
      setPhase('teleported')
      // startedAt was taken before the PTY started, so transcript discovery
      // (if this run is interrupted) looks at files written from then on.
      // Not really local until the conversation is on disk: an abandoned run
      // puts it back in the cloud (lib/teleportRecovery).
      const teleportedAt = result.state?.startedAt ?? new Date().toISOString()
      const { teleportIncomplete: _incomplete, ...rest } = link
      await useSessionStore.getState().patchSession(session.projectId, session.id, {
        location: 'local',
        cloud: { ...rest, teleportedAt },
      })
    } catch (err) {
      setError(`Teleport failed: ${message(err)}`)
      setPhase('error')
    }
  }, [session, project, accounts, register])

  // The teleport went away without the conversation coming down (it is back
  // in the cloud): show the page again.
  useEffect(() => {
    if (!teleportTerminal) setPhase((p) => (p === 'teleported' || p === 'teleport-ended' ? 'web' : p))
  }, [teleportTerminal])

  const dismissIncomplete = useCallback(() => {
    const current = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
    if (!current?.cloud?.teleportIncomplete) return
    const { teleportIncomplete: _incomplete, ...link } = current.cloud
    void useSessionStore.getState().patchSession(current.projectId, current.id, { cloud: link })
  }, [sessionId])

  const openInBrowser = useCallback(() => {
    if (cloud?.url) void window.api.cloudSession.openUrl(cloud.url)
  }, [cloud?.url])

  const dismissError = useCallback(() => {
    setError(null)
    setPhase(teleportTerminal ? 'teleported' : 'web')
  }, [teleportTerminal])

  const openLocally = useCallback(() => {
    if (teleportTerminal) destroyTerminal(teleportTerminal)
    useCloudSessionStore.getState().clearTeleport(sessionId)
  }, [sessionId, teleportTerminal])

  const cleanupBranch = useCallback(
    async (branch: string): Promise<string> => {
      const repoPath = project?.repoPath
      if (!repoPath) throw new Error('Project not found')
      await window.api.worktree.deleteLocalBranch(repoPath, branch)
      let remote = 'and on origin'
      try {
        await window.api.worktree.deleteRemoteBranch(repoPath, branch)
      } catch (err) {
        remote = `locally (origin: ${message(err)})`
      }
      useToastStore.getState().addToast('info', `Deleted ${branch} ${remote}.`)
      return `Deleted ${branch} ${remote}.`
    },
    [project?.repoPath]
  )

  if (!session) return null
  const effectivePhase: CloudAgentPhase = pending
    ? startError
      ? 'create-failed'
      : createPhaseFor(createRun, starting)
    : teleportTerminal
      ? teleportRun?.status === 'failed'
        ? 'teleport-ended'
        : 'teleported'
      : phase
  const createError = startError ?? (createRun?.status === 'failed' ? createRun.error ?? null : null)
  // The create PTY while creating (and its scrollback after a failure), or
  // the still-attached CLI when the user asks for it.
  const shownTerminal =
    teleportTerminal ?? (pending ? createTerminal : showCli && cliAttached ? createTerminal : null)
  return (
    <CloudAgentPanel
      session={session}
      visible={visible}
      phase={effectivePhase}
      terminalId={shownTerminal}
      error={pending ? createError : teleportRun?.status === 'failed' ? teleportRun.error ?? null : error}
      teleportRun={teleportRun}
      onFinishTeleport={finishTeleport}
      mayExist={pending && !!createRun?.mayExist}
      onRetryCreate={pending ? () => void startCreate() : undefined}
      onOpenCloudHome={openCloudHome}
      onDeleteSession={pending ? deleteSession : undefined}
      cliAttached={!pending && !teleportTerminal && cliAttached}
      showingCli={showCli}
      onToggleCli={() => setShowCli((v) => !v)}
      onCloseCli={closeCli}
      dirtyFiles={dirtyFiles}
      onOpenInBrowser={openInBrowser}
      onTeleport={() => void teleport()}
      onDismissError={dismissError}
      onOpenLocally={openLocally}
      teleportIncomplete={!pending && !teleportTerminal && !!cloud?.teleportIncomplete}
      onDismissIncomplete={dismissIncomplete}
      branchNotice={branchNotice}
      onCleanupBranch={cleanupBranch}
      embedWebview={embedWebview}
    />
  )
}

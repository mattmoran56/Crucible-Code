// Drives a cloud session's Agent tab: shows the claude.ai/code session page
// embedded, and teleports the session down to the worktree on request.

import React, { useCallback, useEffect, useState } from 'react'
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
  const branchNotice = useCloudSessionStore((s) => s.branchNotices[sessionId] ?? null)

  const [phase, setPhase] = useState<CloudAgentPhase>(teleportTerminal ? 'teleported' : 'web')
  const [error, setError] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([])

  const cloud = session?.cloud

  const register = useCallback(
    (terminalId: string) => {
      useTerminalStore
        .getState()
        .registerDynamicTerminal(AGENT_TAB, terminalId, sessionId, session?.name ?? sessionId, 'claude', sessionId)
    },
    [sessionId, session?.name]
  )

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
      setPhase('teleport-ended')
      void check()
    })
    return () => {
      done = true
      clearInterval(timer)
      clearTimeout(stop)
      offExit?.()
    }
  }, [teleportTerminal, sessionId])

  const teleport = useCallback(async () => {
    if (!session?.cloud) return
    const link = session.cloud
    setPhase('teleport-checking')
    setDirtyFiles([])
    setError(null)
    // Recorded before the PTY starts so transcript discovery on a later
    // launch looks at files written from here on.
    const teleportedAt = new Date().toISOString()
    try {
      const result = await window.api.cloudSession.teleport({
        sessionId: session.id,
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
      // Keep this tab on the teleport PTY for the rest of this run, even
      // though the session is local from now on.
      useCloudSessionStore.getState().setTeleport(session.id, result.terminalId)
      setPhase('teleported')
      await useSessionStore.getState().patchSession(session.projectId, session.id, {
        location: 'local',
        cloud: { ...link, teleportedAt },
      })
    } catch (err) {
      setError(`Teleport failed: ${message(err)}`)
      setPhase('error')
    }
  }, [session, project, accounts, register])

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
  return (
    <CloudAgentPanel
      session={session}
      visible={visible}
      phase={phase}
      terminalId={teleportTerminal}
      error={error}
      dirtyFiles={dirtyFiles}
      onOpenInBrowser={openInBrowser}
      onTeleport={() => void teleport()}
      onDismissError={dismissError}
      onOpenLocally={openLocally}
      branchNotice={branchNotice}
      onCleanupBranch={cleanupBranch}
      embedWebview={embedWebview}
    />
  )
}

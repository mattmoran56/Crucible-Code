// Drives a cloud session's Agent tab: attaches a terminal to the Claude Code on
// the web session, and teleports it down to the worktree on request.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ATTACH_NOT_ENABLED } from '../../../shared/cloud-session'
import { projectConfigDir } from '../../lib/visualAgents'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { destroyTerminal } from '../terminal/useTerminal'
import { CloudAgentPanel, type CloudAgentPhase } from './CloudAgentPanel'

/** The Agent tab id the cloud PTYs report under (matches the main process). */
const AGENT_TAB = 'agent'

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[@-_]/g

/** Whether terminal output says attaching is not enabled (ANSI and line wraps ignored). */
export const saysAttachNotEnabled = (output: string): boolean =>
  output.replace(ANSI, '').replace(/\s+/g, ' ').includes(ATTACH_NOT_ENABLED)

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function CloudAgentHost({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const project = useProjectStore((s) => s.projects.find((p) => p.id === session?.projectId))
  const accounts = useProjectStore((s) => s.claudeAccounts)
  const teleportTerminal = useCloudSessionStore((s) => s.teleports[sessionId] ?? null)

  const [phase, setPhase] = useState<CloudAgentPhase>(teleportTerminal ? 'teleported' : 'attaching')
  const [attachId, setAttachId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirtyFiles, setDirtyFiles] = useState<string[]>([])

  const cloud = session?.cloud
  const ptyOptions = useCallback(() => {
    if (!session?.cloud) throw new Error('This session has no cloud session')
    return {
      sessionId: session.id,
      worktreePath: session.worktreePath,
      cloudSessionId: session.cloud.sessionId,
      configDir: projectConfigDir(project, accounts),
      repoPath: project?.repoPath,
      claudeTheme: useSettingsStore.getState().claudeTheme,
    }
  }, [session, project, accounts])

  const register = useCallback(
    (terminalId: string) => {
      useTerminalStore
        .getState()
        .registerDynamicTerminal(AGENT_TAB, terminalId, sessionId, session?.name ?? sessionId, 'claude', sessionId)
    },
    [sessionId, session?.name]
  )

  const attach = useCallback(async () => {
    setPhase('attaching')
    setError(null)
    try {
      const id = await window.api.cloudSession.attach(ptyOptions())
      setAttachId((previous) => {
        if (previous && previous !== id) destroyTerminal(previous)
        return id
      })
      register(id)
      setPhase('attached')
    } catch (err) {
      setError(`Couldn't attach to the cloud session: ${message(err)}`)
      setPhase('error')
    }
  }, [ptyOptions, register])

  // Attach the first time the tab is shown (not for a session teleported this run).
  const started = useRef(false)
  useEffect(() => {
    if (!visible || started.current || teleportTerminal || session?.location !== 'cloud' || !cloud) return
    started.current = true
    void attach()
  }, [visible, teleportTerminal, session?.location, cloud, attach])

  // Watch the terminal on screen: spot "attach not enabled", and notice exits.
  const currentId = teleportTerminal ?? attachId
  const isTeleport = !!teleportTerminal
  useEffect(() => {
    if (!currentId) return
    let tail = ''
    const offData = window.api.terminal.onData((id, data) => {
      if (id !== currentId || isTeleport) return
      tail = (tail + data).slice(-4000)
      if (saysAttachNotEnabled(tail)) setPhase('attach-unavailable')
    })
    const offExit = window.api.terminal.onExit((id) => {
      if (id !== currentId) return
      setPhase((p) => (isTeleport ? 'teleport-ended' : p === 'attach-unavailable' ? p : 'attach-ended'))
    })
    return () => {
      offData?.()
      offExit?.()
    }
  }, [currentId, isTeleport])

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
      const result = await window.api.cloudSession.teleport(ptyOptions())
      if (!result.ok) {
        setDirtyFiles(result.files)
        setPhase('teleport-blocked')
        return
      }
      // The main process killed the attach PTY; drop its xterm too.
      setAttachId((previous) => {
        if (previous) destroyTerminal(previous)
        return null
      })
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
  }, [session, ptyOptions, register])

  const openInBrowser = useCallback(() => {
    if (cloud?.url) void window.api.cloudSession.openUrl(cloud.url)
  }, [cloud?.url])

  const sendFollowUp = useCallback(
    async (text: string) => {
      if (!session?.cloud) return
      await window.api.cloudSession.send({
        worktreePath: session.worktreePath,
        cloudSessionId: session.cloud.sessionId,
        message: text,
        configDir: projectConfigDir(project, accounts),
      })
    },
    [session, project, accounts]
  )

  const openLocally = useCallback(() => {
    if (teleportTerminal) destroyTerminal(teleportTerminal)
    useCloudSessionStore.getState().clearTeleport(sessionId)
  }, [sessionId, teleportTerminal])

  if (!session) return null
  return (
    <CloudAgentPanel
      session={session}
      visible={visible}
      phase={phase}
      terminalId={currentId}
      error={error}
      dirtyFiles={dirtyFiles}
      onOpenInBrowser={openInBrowser}
      onTeleport={() => void teleport()}
      onReattach={() => void attach()}
      onSendFollowUp={sendFollowUp}
      onOpenLocally={openLocally}
    />
  )
}

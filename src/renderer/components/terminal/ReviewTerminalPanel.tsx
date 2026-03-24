import React, { useEffect, useRef } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { TerminalView } from './TerminalView'

interface Props {
  visible?: boolean
}

export function ReviewTerminalPanel({ visible = true }: Props) {
  const { activeSessionId, activePRNumber, sessions } = useSessionStore()
  const { projects, activeProjectId } = useProjectStore()
  const { spawnTerminal, getTerminal, killTerminal, terminals } = useTerminalStore()
  const sentCommandRef = useRef<string | null>(null)

  // Derive cwd and a stable key for the terminal
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const { pullRequests } = usePRStore()
  const cwd = activeSession?.worktreePath ?? activeProject?.repoPath

  // Match session branch to a PR in the list
  const sessionPR = activeSession
    ? pullRequests.find((pr) => pr.headRefName === activeSession.branchName)
    : null
  const effectivePRNumber = activePRNumber ?? sessionPR?.number ?? null

  // Use session ID if available, otherwise a synthetic key for PR-only mode
  const terminalSessionId = activeSessionId ?? (effectivePRNumber != null ? `pr-review-${effectivePRNumber}` : null)
  const terminalName = activeSession?.name ?? `PR #${effectivePRNumber}`

  // Spawn a review terminal and send /review command
  useEffect(() => {
    if (!cwd || !terminalSessionId || effectivePRNumber == null) return

    const existing = getTerminal(terminalSessionId, 'review')
    const commandKey = `${terminalSessionId}:${effectivePRNumber}`

    if (!existing) {
      sentCommandRef.current = null
      spawnTerminal(terminalSessionId, terminalName, cwd, 'review').then(
        (terminalId) => {
          if (sentCommandRef.current !== commandKey) {
            // Listen for Claude Code to be ready, then send the review command
            const unsub = window.api.terminal.onData((tid, data) => {
              if (tid !== terminalId || sentCommandRef.current === commandKey) return
              // Claude Code shows ">" or the prompt character when ready
              if (data.includes('>') || data.includes('$')) {
                sentCommandRef.current = commandKey
                unsub()
                // Small delay to ensure prompt is fully rendered
                setTimeout(() => {
                  window.api.terminal.write(terminalId, `/review ${effectivePRNumber}\r`)
                }, 100)
              }
            })
            // Fallback: if we don't detect readiness within 10s, send anyway
            setTimeout(() => {
              if (sentCommandRef.current !== commandKey) {
                sentCommandRef.current = commandKey
                unsub()
                window.api.terminal.write(terminalId, `/review ${effectivePRNumber}\r`)
              }
            }, 10000)
          }
        }
      )
    }
  }, [terminalSessionId, effectivePRNumber, cwd, terminalName, getTerminal, spawnTerminal])

  // Kill the review terminal when PR changes or closes
  useEffect(() => {
    return () => {
      const state = useSessionStore.getState()
      const sid = state.activeSessionId
      const session = state.sessions.find((s) => s.id === sid)
      const prs = usePRStore.getState().pullRequests
      const matchedPR = session ? prs.find((pr) => pr.headRefName === session.branchName) : null
      const prNum = state.activePRNumber ?? matchedPR?.number ?? null
      const key = sid ?? (prNum != null ? `pr-review-${prNum}` : null)
      if (key) {
        const existing = useTerminalStore.getState().getTerminal(key, 'review')
        if (existing) {
          useTerminalStore.getState().killTerminal(key, 'review')
        }
      }
    }
  }, [effectivePRNumber])

  if (effectivePRNumber == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Open a PR to start a review
      </div>
    )
  }

  if (!terminalSessionId) return null

  const instance = getTerminal(terminalSessionId, 'review')
  if (!instance) return null

  return (
    <div className="flex-1 relative min-h-0">
      <TerminalView
        key={instance.terminalId}
        terminalId={instance.terminalId}
        sessionId={terminalSessionId}
        sessionName={terminalName}
        visible={visible}
      />
    </div>
  )
}

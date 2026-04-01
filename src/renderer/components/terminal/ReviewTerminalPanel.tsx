import React, { useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { usePRStore } from '../../stores/prStore'
import { TerminalView } from './TerminalView'

interface Props {
  visible?: boolean
}

// Module-level set — survives across all renders and never resets
const reviewsLaunched = new Set<string>()

export function ReviewTerminalPanel({ visible = true }: Props) {
  const { activeSessionId, activePRNumber, sessions } = useSessionStore()
  const { projects, activeProjectId } = useProjectStore()
  const { spawnTerminal, getTerminal, terminals } = useTerminalStore()
  const { pullRequests } = usePRStore()

  // Derive cwd and a stable key for the terminal
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const cwd = activeSession?.worktreePath ?? activeProject?.repoPath

  // Match session branch to a PR in the list
  const sessionPR = activeSession
    ? pullRequests.find((pr) => pr.headRefName === activeSession.branchName)
    : null
  const effectivePRNumber = activePRNumber ?? sessionPR?.number ?? null

  // Use session ID if available, otherwise a synthetic key for PR-only mode
  const terminalSessionId = activeSessionId ?? (effectivePRNumber != null ? `pr-review-${effectivePRNumber}` : null)
  const terminalName = activeSession?.name ?? `PR #${effectivePRNumber}`
  const commandKey = terminalSessionId && effectivePRNumber != null
    ? `${terminalSessionId}:${effectivePRNumber}`
    : null

  // Spawn a review terminal and send /review command — only once per session+PR
  useEffect(() => {
    if (!cwd || !terminalSessionId || effectivePRNumber == null || !commandKey) return
    if (reviewsLaunched.has(commandKey)) return

    const existing = getTerminal(terminalSessionId, 'review')
    if (existing) {
      // Terminal already exists (e.g. from a previous render cycle), mark as launched
      reviewsLaunched.add(commandKey)
      return
    }

    reviewsLaunched.add(commandKey)

    let unsub: (() => void) | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let sent = false

    spawnTerminal(terminalSessionId, terminalName, cwd, 'review').then(
      (terminalId) => {
        unsub = window.api.terminal.onData((tid, data) => {
          if (tid !== terminalId || sent) return
          if (data.includes('>') || data.includes('$')) {
            sent = true
            unsub?.()
            unsub = null
            setTimeout(() => {
              window.api.terminal.write(terminalId, `/review ${effectivePRNumber}\r`)
            }, 100)
          }
        })
        timeoutId = setTimeout(() => {
          if (!sent) {
            sent = true
            unsub?.()
            unsub = null
            window.api.terminal.write(terminalId, `/review ${effectivePRNumber}\r`)
          }
        }, 10000)
      }
    )

    return () => {
      unsub?.()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [terminalSessionId, effectivePRNumber, cwd, terminalName, commandKey, getTerminal, spawnTerminal])

  if (effectivePRNumber == null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Open a PR to start a review
      </div>
    )
  }

  if (!terminalSessionId) return null

  // Render all review terminals, toggle visibility (same pattern as TerminalPanel)
  const allReviewInstances = Object.values(terminals).filter((t) => t.mode === 'review')

  if (allReviewInstances.length === 0) return null

  return (
    <div className="flex-1 relative min-h-0">
      {allReviewInstances.map((instance) => {
        const isActive = instance.sessionId === terminalSessionId && visible
        return (
          <TerminalView
            key={instance.terminalId}
            terminalId={instance.terminalId}
            sessionId={instance.sessionId}
            sessionName={instance.sessionName}
            visible={isActive}
          />
        )
      })}
    </div>
  )
}

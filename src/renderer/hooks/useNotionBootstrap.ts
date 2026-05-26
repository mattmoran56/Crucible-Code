import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTerminalStore } from '../stores/terminalStore'
import { useToastStore } from '../stores/toastStore'
import { writeWhenReady } from '../lib/writeWhenReady'

/**
 * Subscribes to NOTION_FIRE_TASK events from the main-process poller. For each
 * fired task, creates a session and proactively spawns its claude terminal
 * with the startup prompt injected via writeWhenReady — the same mechanism
 * the Review tab uses. Going through writeWhenReady directly (rather than
 * relying on sessionStore.pendingStartup) is what keeps multiple tasks fired
 * in a single poll tick from clobbering each other: pendingStartup is a
 * single slot, so back-to-back createSession calls would lose all but the
 * last command.
 *
 * Mount once at the top of the component tree (sibling of useSchedulerBootstrap).
 */
export function useNotionBootstrap(): void {
  useEffect(() => {
    const off = window.api.notion.onFireTask(async (payload) => {
      const project = useProjectStore.getState().projects.find((p) => p.id === payload.projectId)
      if (!project) {
        // Project was removed since the poller started; nothing to do.
        return
      }
      try {
        // Don't pass startupCommand into createSession — we'll inject it
        // ourselves below to avoid the single-slot pendingStartup race when
        // many tasks fire in one tick.
        await useSessionStore
          .getState()
          .createSession(
            payload.projectId,
            project.repoPath,
            payload.suggestedSessionName,
            undefined,
            undefined
          )
        const newId = useSessionStore.getState().activeSessionId
        const newSession = useSessionStore.getState().sessions.find((s) => s.id === newId)
        if (!newSession) return

        // Spawn the claude terminal up-front (same pattern as ReviewTerminalPanel)
        // and arm writeWhenReady against it. If this session never becomes the
        // active one (because a later fire overwrites activeSessionId), the
        // terminal still exists and the command still gets injected once the
        // PTY shows a prompt.
        const terminalId = await useTerminalStore
          .getState()
          .spawnTerminal(
            newSession.id,
            newSession.name,
            newSession.worktreePath,
            'claude',
            false,
            newSession.id,
            'agent'
          )
        writeWhenReady(terminalId, payload.resolvedStartupPrompt)

        await window.api.notion.applyWriteBack(
          payload.projectId,
          payload.page,
          newSession.branchName,
          newSession.id
        )
        useToastStore.getState().addToast('info', `New Notion task: ${payload.page.title || payload.page.id}`)
      } catch (err) {
        useToastStore
          .getState()
          .addToast('error', `Notion task pickup failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    return () => {
      off()
    }
  }, [])
}

import { useEffect } from 'react'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../stores/toastStore'

/**
 * Subscribes to NOTION_FIRE_TASK events from the main-process poller. For each
 * fired task, creates a session with the resolved startup prompt and then
 * calls back to main with the new branch/session id so the poller can apply
 * any property updates / appended blocks that reference {{branch}} or
 * {{sessionId}}.
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
        await useSessionStore
          .getState()
          .createSession(
            payload.projectId,
            project.repoPath,
            payload.suggestedSessionName,
            undefined,
            payload.resolvedStartupPrompt
          )
        // createSession sets activeSessionId on success. Look up the new session
        // to grab its real branchName (createSession may have suffixed it).
        const newId = useSessionStore.getState().activeSessionId
        const newSession = useSessionStore.getState().sessions.find((s) => s.id === newId)
        if (!newSession) return
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

// Replays the web notifications a cloud session's embedded claude.ai page
// raises as Crucible notifications on the session they are about. The main
// process intercepts them in the page (main/services/claude-web-notifications)
// and sends them here; we work out which Crucible session they belong to and
// hand them back to main to show, after noting them for the session's card.

import { cloudNoticeKind, type CloudWebNotificationEvent } from '../../shared/cloud-session'
import type { Session } from '../../shared/types'
import { sessionOfCloudGuest } from '../components/agent-browser/AgentBrowserLayer'
import { useCloudNoticeStore } from '../stores/cloudNoticeStore'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'

export interface ResolveDeps {
  /** Sessions already loaded (the active project's). */
  loaded: () => Session[]
  /** Every project's id, to look further. */
  projectIds: () => string[]
  listSessions: (projectId: string) => Promise<Session[]>
  /** The session whose Agent tab holds guest page `webContentsId`. */
  sessionOfGuest: (webContentsId: number) => string | null
}

const defaultDeps: ResolveDeps = {
  loaded: () => useSessionStore.getState().sessions,
  projectIds: () => useProjectStore.getState().projects.map((p) => p.id),
  listSessions: (projectId) => window.api.session.list(projectId),
  sessionOfGuest: (id) => sessionOfCloudGuest(id),
}

/**
 * The Crucible session a claude.ai notification is about. Any page can notify
 * about any of the user's cloud sessions, so the cloud session id the
 * notification named wins, looked up across every project; a named cloud
 * session the app doesn't have resolves to null. With no id, it is the session
 * whose page raised it.
 */
export async function resolveCloudNotificationSession(
  event: CloudWebNotificationEvent,
  deps: ResolveDeps = defaultDeps,
): Promise<string | null> {
  const cloudId = event.cloudSessionId
  if (!cloudId) return deps.sessionOfGuest(event.webContentsId)
  const match = (s: Session) => s.cloud?.sessionId === cloudId
  const loaded = deps.loaded().find(match)
  if (loaded) return loaded.id
  for (const projectId of deps.projectIds()) {
    try {
      const found = (await deps.listSessions(projectId)).find(match)
      if (found) return found.id
    } catch {
      // A project that fails to list just can't claim it.
    }
  }
  return null
}

/** Handle one relayed notification: remember it on its session and show it. */
export async function relayCloudWebNotification(
  event: CloudWebNotificationEvent,
  deps: ResolveDeps = defaultDeps,
  now: () => number = Date.now,
): Promise<string | null> {
  const sessionId = await resolveCloudNotificationSession(event, deps)
  const kind = cloudNoticeKind(event.title, event.body)
  if (sessionId) {
    useCloudNoticeStore.getState().setNotice(sessionId, { title: event.title, body: event.body, kind, at: now() })
  }
  await window.api.notification.relayCloudNotification(sessionId, event.title, event.body, kind)
  return sessionId
}

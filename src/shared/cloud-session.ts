// Shared bits of the cloud sessions feature (Claude Code on the web).

import type { Project, SessionLocation } from './types'

/**
 * Where a project's new sessions run. Undefined means CLOUD — the user wants
 * Claude Code on the web as the default so CI/test load stays off their
 * machine (a deliberate exception to "optional features default off").
 */
export const resolveDefaultSessionLocation = (project: Pick<Project, 'defaultSessionLocation'> | null | undefined): SessionLocation =>
  project?.defaultSessionLocation === 'local' ? 'local' : 'cloud'

/**
 * The persistent Electron session partition the embedded claude.ai/code page
 * uses: the user signs in to claude.ai once and stays signed in, isolated
 * from the app's own session.
 */
export const CLAUDE_WEB_PARTITION = 'persist:claude-web'

/**
 * The message the app sends from the embedded claude.ai page right after a
 * cloud session is created, to start its work. claude.ai attaches the user's
 * connectors (Notion, Slack, Gmail…) to a cloud session only when a message
 * from the claude.ai web client arrives; the CLI's create message carries none.
 * So the create task tells the agent to hold, and this message starts it with
 * the connectors attached (see renderer lib/cloudKickoff).
 */
export const CLOUD_KICKOFF_MESSAGE =
  'Start the task now. (Sent automatically by Crucible from the claude.ai page, so your claude.ai connectors are attached to this session.)'

/** Short form of a cloud session id for toolbars: `session_01AbCdEf…` → `01AbCdEf`. */
export const shortCloudId = (id: string): string => id.replace(/^session_/, '').slice(0, 8)

/**
 * A web notification a cloud session's embedded claude.ai page raised
 * (main → renderer). The page's own notifications are intercepted and
 * replayed as Crucible notifications on the session they are about
 * (main/services/claude-web-notifications).
 */
export interface CloudWebNotificationEvent {
  /** The guest page that raised it (maps to the session whose Agent tab holds it). */
  webContentsId: number
  title: string
  body: string
  /** The cloud session it is about (`session_...`), when the page said. */
  cloudSessionId: string | null
}

/** What a relayed claude.ai notification means for its session. */
export type CloudNoticeKind = 'attention' | 'completed'

/**
 * Whether a claude.ai notification says the session finished (completed) or
 * wants something from the user (attention, the default).
 */
export function cloudNoticeKind(title: string, body: string): CloudNoticeKind {
  const text = `${title} ${body}`
  if (/\b(needs?|waiting|approv|permission|input|question|respond|reply|action required|blocked)/i.test(text)) return 'attention'
  return /\b(finished|complete[ds]?|done|ready for review|succeeded)\b/i.test(text) ? 'completed' : 'attention'
}

/** The latest claude.ai notification shown for a session (kept until dismissed or replaced). */
export interface CloudNotice {
  title: string
  body: string
  kind: CloudNoticeKind
  /** ms since epoch. */
  at: number
}

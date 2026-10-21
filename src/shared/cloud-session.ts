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

/** Short form of a cloud session id for toolbars: `session_01AbCdEf…` → `01AbCdEf`. */
export const shortCloudId = (id: string): string => id.replace(/^session_/, '').slice(0, 8)

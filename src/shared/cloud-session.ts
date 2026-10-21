// Shared bits of the cloud sessions feature (Claude Code on the web).

import type { Project, SessionLocation } from './types'

/**
 * Where a project's new sessions run. Undefined means CLOUD — the user wants
 * Claude Code on the web as the default so CI/test load stays off their
 * machine (a deliberate exception to "optional features default off").
 */
export const resolveDefaultSessionLocation = (project: Pick<Project, 'defaultSessionLocation'> | null | undefined): SessionLocation =>
  project?.defaultSessionLocation === 'local' ? 'local' : 'cloud'

/** What Claude Code prints when attaching to a running cloud session is not enabled for the account. */
export const ATTACH_NOT_ENABLED = 'Attaching to an existing cloud session is not enabled for your account'

/** Short form of a cloud session id for toolbars: `session_01AbCdEf…` → `01AbCdEf`. */
export const shortCloudId = (id: string): string => id.replace(/^session_/, '').slice(0, 8)

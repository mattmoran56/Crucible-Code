/**
 * Session branch naming and validation, shared by the main process (which
 * creates/deletes branches) and the renderer (create dialog).
 */
import type { Session, SessionLocation } from './types'

/**
 * Prefix for an app-created session branch, per location. Claude Code on the
 * web does not restrict which branches a session may push to, so both use
 * `session/`; switch `cloud` to `claude/` here if that ever changes.
 */
export const SESSION_BRANCH_PREFIX: Record<SessionLocation, string> = {
  local: 'session/',
  cloud: 'session/',
}

/**
 * A session's human-readable name as a branch / directory segment: lowercased,
 * with each run of whitespace replaced by a hyphen (`Fix Auth Bug` → `fix-auth-bug`).
 */
export const sessionNameSlug = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, '-')

export const defaultSessionBranch = (name: string, location: SessionLocation = 'local'): string =>
  `${SESSION_BRANCH_PREFIX[location]}${sessionNameSlug(name)}`

/** The branch a local session named `name` gets when it was not customised. */
export const isDefaultSessionBranch = (branch: string, name: string): boolean =>
  (Object.values(SESSION_BRANCH_PREFIX) as string[]).some((p) => branch === `${p}${sessionNameSlug(name)}`)

/**
 * Roughly `git check-ref-format --branch`. Returns a human-readable error, or
 * null when the name is acceptable.
 */
export function validateBranchName(branch: string): string | null {
  if (!branch || !branch.trim()) return 'Branch name is required'
  if (/\s/.test(branch)) return 'Branch name cannot contain spaces'
  if (branch.startsWith('-')) return 'Branch name cannot start with "-"'
  if (branch.startsWith('/')) return 'Branch name cannot start with "/"'
  if (branch.endsWith('/')) return 'Branch name cannot end with "/"'
  if (branch.endsWith('.lock')) return 'Branch name cannot end with ".lock"'
  if (branch.endsWith('.')) return 'Branch name cannot end with "."'
  if (branch.includes('..')) return 'Branch name cannot contain ".."'
  if (branch.includes('//')) return 'Branch name cannot contain "//"'
  if (branch.includes('@{')) return 'Branch name cannot contain "@{"'
  if (branch === '@') return 'Branch name cannot be "@"'
  if (/[~^:?*[\\]/.test(branch)) return 'Branch name cannot contain ~ ^ : ? * [ or \\'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(branch)) return 'Branch name cannot contain control characters'
  if (branch.split('/').some((part) => part.startsWith('.'))) return 'Branch name parts cannot start with "."'
  return null
}

/**
 * The branch a session's remote copy lives on: the session's branch (which
 * follows reality after a teleport), else the one the cloud agent was given.
 */
export const sessionRemoteBranch = (session: Pick<Session, 'branchName' | 'cloud'>): string | undefined =>
  session.branchName || session.cloud?.branch || undefined

/**
 * Whether removing the session also deletes its local branch: `session/*`
 * branches always are, and any branch the app created for the session.
 */
export const sessionDeletesLocalBranch = (session: Pick<Session, 'branchName' | 'ownsBranch'>): boolean =>
  !!session.branchName && (session.branchName.startsWith('session/') || !!session.ownsBranch)

/** Whether renaming the session renames its branch (see sessionStore.renameSession). */
export const renameMovesBranch = (session: Pick<Session, 'name' | 'branchName' | 'cloud' | 'cloudPending'>): boolean =>
  !session.cloud && !session.cloudPending && session.branchName === defaultSessionBranch(session.name)

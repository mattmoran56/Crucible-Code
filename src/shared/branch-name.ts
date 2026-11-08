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

/** The branch types a suggested branch may start with: `feat/…`, `fix/…`, `chore/…`. */
export const BRANCH_TYPES = ['feat', 'fix', 'chore'] as const
export type BranchType = (typeof BRANCH_TYPES)[number]

/** Longest description (the part after `type/`) of a suggested branch, in characters. */
export const MAX_BRANCH_DESCRIPTION = 40

/**
 * Turn a model's suggested branch (`feat/add-dark-mode`, `Fix: login redirect`)
 * into a `type/short-description` branch: the type is feat, fix or chore
 * (chore when the model gave none we use), and the description is lowercase
 * words joined by hyphens, at most five words and MAX_BRANCH_DESCRIPTION
 * characters. `fallbackDescription` (e.g. the session name) is used when the
 * suggestion has no description. Null when nothing usable is left.
 */
export function toTypedBranchName(raw: string, fallbackDescription = ''): string | null {
  const line = (raw.trim().split('\n')[0] ?? '').trim().toLowerCase().replace(/^[`'"]+|[`'"]+$/g, '')
  const typed = /^(feat|feature|fix|bugfix|chore)\s*[/:(-]\s*(.*)$/.exec(line)
  let type: BranchType = 'chore'
  let rest = line
  if (typed) {
    type = typed[1] === 'feature' ? 'feat' : typed[1] === 'bugfix' ? 'fix' : (typed[1] as BranchType)
    rest = typed[2]
  }
  const slug = (text: string): string => {
    let out = ''
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 5)) {
      const next = out ? `${out}-${word}` : word
      if (next.length > MAX_BRANCH_DESCRIPTION) break
      out = next
    }
    return out
  }
  const description = slug(rest) || slug(fallbackDescription)
  return description ? `${type}/${description}` : null
}

/** `branch`, or `branch-2`, `branch-3`… — the first one not in `taken`. */
export function uniqueBranchName(branch: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(branch)) return branch
  let n = 2
  while (used.has(`${branch}-${n}`)) n++
  return `${branch}-${n}`
}

/**
 * A placeholder name for a session whose name is picked from its first prompt
 * (`new-session-3f9a2c`). Its worktree directory and placeholder branch
 * (`session/new-session-3f9a2c`) are derived from it, and stay unique without
 * checking what already exists.
 */
export function placeholderSessionName(random: () => string = randomSuffix): string {
  return `new-session-${random()}`
}

/**
 * The placeholder branch for a session named `name` whose branch is picked
 * from its first prompt: its default `session/<name>` branch, plus a random
 * suffix when the name is the user's own (so it never takes the branch the
 * name would otherwise get).
 */
export function placeholderSessionBranch(name: string, namePending: boolean, random: () => string = randomSuffix): string {
  return namePending ? defaultSessionBranch(name) : `${defaultSessionBranch(name)}-${random()}`
}

export function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 8).padEnd(6, '0')
}

/** Whether renaming the session renames its branch (see sessionStore.renameSession). */
export const renameMovesBranch = (session: Pick<Session, 'name' | 'branchName' | 'cloud' | 'cloudPending'>): boolean =>
  !session.cloud && !session.cloudPending && session.branchName === defaultSessionBranch(session.name)

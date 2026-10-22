// After a teleport, `claude --teleport` checks out the cloud session's work
// branch. The app created (and told the cloud agent to use) the session's
// branch, so normally nothing changes — but if the worktree ends up on some
// other branch, the session follows reality and the user is told. Nothing is
// renamed or deleted on their behalf.

import type { Session } from '../../shared/types'
import { useSessionStore } from '../stores/sessionStore'

export interface BranchMismatch {
  /** The branch the session had (the one the app created). */
  expected: string
  /** The branch the worktree is actually on now. */
  actual: string
}

/** A mismatch, or null when the worktree is on the expected branch (or detached / unknown). */
export function branchMismatch(expected: string, actual: string | null | undefined): BranchMismatch | null {
  const real = actual?.trim()
  if (!real || real === expected) return null
  return { expected, actual: real }
}

/**
 * Read the worktree's current branch; on a mismatch, point the session at it
 * and return the mismatch. Returns null when nothing changed or the branch
 * could not be read.
 */
export async function reconcileTeleportBranch(session: Session): Promise<BranchMismatch | null> {
  let actual: string | null = null
  try {
    actual = await window.api.worktree.currentBranch(session.worktreePath)
  } catch {
    return null
  }
  const mismatch = branchMismatch(session.branchName, actual)
  if (!mismatch) return null
  // The app did not create the branch the teleport checked out, so deleting
  // the session must not delete it as if it had (unless it is a session/* one).
  await useSessionStore
    .getState()
    .patchSession(session.projectId, session.id, { branchName: mismatch.actual, ownsBranch: false })
  return mismatch
}

export const branchMismatchToast = (sessionName: string, m: BranchMismatch): string =>
  `${sessionName}: teleport checked out ${m.actual} instead of ${m.expected}. The session now follows ${m.actual}; ${m.expected} was left as it is.`

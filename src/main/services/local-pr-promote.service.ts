import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import Store from 'electron-store'
import type { LocalPR, Project } from '../../shared/types'
import { getStorePath } from '../store-path'
import * as github from './github.service'
import {
  getLocalPR,
  patchLocalPR,
  appendLog,
} from './local-pr.service'

const execFileAsync = promisify(execFile)

/** Read the project's repo path the same way foundry.ipc / project.ipc do. */
function getProjectRepoPath(projectId: string): string | null {
  const projectsStore = new Store<{ projects: Project[] }>({
    cwd: getStorePath(),
    defaults: { projects: [] },
  })
  const project = projectsStore.get('projects', []).find((p) => p.id === projectId)
  return project?.repoPath ?? null
}

/**
 * Pick a working directory inside the repo to run gh/git from. Prefer the
 * record's own worktree (still on disk), else fall back to the project repo
 * root. `gh pr create --head <branch>` works from any worktree of the repo as
 * long as the branch is on the remote.
 */
function resolveCwd(lpr: LocalPR): string | null {
  if (lpr.worktreePath && existsSync(lpr.worktreePath)) return lpr.worktreePath
  return getProjectRepoPath(lpr.projectId)
}

/** Resolve the base branch the real PR should target (chained-stack aware). */
function resolveBase(lpr: LocalPR): string {
  if (lpr.parentLocalPrId) {
    const parent = getLocalPR(lpr.parentLocalPrId)
    // Parent's head branch is its real branch once it exists on origin.
    if (parent) return parent.branch
  }
  return lpr.baseBranch
}

export interface PromoteOptions {
  /** Flip the freshly-opened draft PR to ready-for-review. Default false. */
  markReady?: boolean
}

/**
 * Promote a local PR to a real GitHub PR. Atomic and idempotent: pushes the
 * branch, opens a draft PR from the approved title/body/base (or returns the
 * existing one), and transitions the record to `open`. The Foundry batch reuses
 * this for each PR in the stack.
 */
export async function promoteLocalPR(
  id: string,
  opts: PromoteOptions = {}
): Promise<LocalPR | null> {
  const lpr = getLocalPR(id)
  if (!lpr) return null
  if (lpr.status === 'merged') return lpr

  const cwd = resolveCwd(lpr)
  if (!cwd) {
    return patchLocalPR(id, {
      status: 'error',
      attention: { reason: 'No worktree or project repo found to promote from', since: new Date().toISOString() },
    })
  }

  patchLocalPR(id, { status: 'promoting' })
  const base = resolveBase(lpr)

  try {
    // 1. Ensure the branch is on origin. `gh pr create` needs it remotely.
    appendLog(id, `pushing ${lpr.branch} to origin`)
    await execFileAsync('git', ['push', 'origin', lpr.branch], { cwd })

    // 2. Open (or find existing) draft PR — createDraftPR is idempotent.
    appendLog(id, `opening PR ${lpr.branch} → ${base}`)
    const pr = await github.createDraftPR(cwd, {
      title: lpr.title,
      body: lpr.body,
      base,
      head: lpr.branch,
    })

    let next = patchLocalPR(id, {
      status: 'open',
      realPrNumber: pr.number,
      realPrUrl: pr.url,
      baseBranch: base,
      attention: undefined,
    })

    // 3. Flip to ready-for-review when the caller asks, or when the worker
    //    already marked the local PR ready (captured `gh pr ready`).
    if (opts.markReady || lpr.readyForReview) {
      appendLog(id, `marking PR #${pr.number} ready`)
      await github.markPRReady(cwd, pr.number)
    }
    appendLog(id, `promoted to PR #${pr.number}`)
    return next ?? getLocalPR(id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(id, `promote failed: ${msg}`)
    return patchLocalPR(id, {
      status: 'error',
      attention: { reason: `Promote failed: ${msg}`, since: new Date().toISOString() },
    })
  }
}

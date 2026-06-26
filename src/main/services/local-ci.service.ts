import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { FoundryConfig, LocalPR, LocalPRCIResult, PRCheck } from '../../shared/types'

/**
 * Local CI runner. Wraps `act` (nektos/act) to run the repo's GitHub Actions
 * workflows in Docker, giving high-confidence pass/fail before/after promoting
 * a PR — without waiting on real GitHub Actions.
 *
 * v1 derives status from the runner's exit code and stores the full log on disk
 * (only a tail is kept in state). `act` can't run private/Marketplace actions
 * needing auth, lacks real secrets, and needs Docker running — so treat results
 * as high-confidence advisory; real GitHub CI remains the source of truth after
 * promote.
 */
export type LocalCIConfig = NonNullable<FoundryConfig['localCi']>

const DEFAULT_IMAGE = 'catthehacker/ubuntu:act-latest'

function logDir(): string {
  return join(app.getPath('userData'), 'local-ci-logs')
}

/** Build the act argv (or split a full command override). */
function buildArgs(cfg: LocalCIConfig): { cmd: string; args: string[] } {
  if (cfg.command && cfg.command.trim()) {
    const parts = cfg.command.trim().split(/\s+/)
    return { cmd: parts[0], args: parts.slice(1) }
  }
  const image = cfg.image?.trim() || DEFAULT_IMAGE
  const args = ['-P', `ubuntu-latest=${image}`]
  if (cfg.workflowFilter?.trim()) args.push('-W', cfg.workflowFilter.trim())
  return { cmd: cfg.runner === 'act' ? 'act' : cfg.runner, args }
}

/**
 * Run local CI for a promoted local PR. Returns a result mapped onto the same
 * PRCheck/CIStatus shapes the UI already uses for remote PRs.
 */
export async function runLocalCI(lpr: LocalPR, cfg: LocalCIConfig): Promise<LocalPRCIResult> {
  const cwd = lpr.worktreePath
  const ranAt = new Date().toISOString()
  if (!cwd) {
    return { status: 'failure', checks: failCheck('no worktree to run CI in'), ranAt, runner: cfg.runner }
  }

  const { cmd, args } = buildArgs(cfg)
  const timeoutMs = (cfg.timeoutMinutes ?? 30) * 60_000

  const { code, output } = await run(cmd, args, cwd, timeoutMs)

  // Persist the full log; keep only a path + short tail in state.
  let logTailPath: string | undefined
  try {
    await mkdir(logDir(), { recursive: true })
    logTailPath = join(logDir(), `${lpr.id}.log`)
    await writeFile(logTailPath, output, 'utf8')
  } catch {
    /* non-fatal */
  }

  const status = code === 0 ? 'success' : 'failure'
  const check: PRCheck = {
    name: `local-ci (${cfg.runner})`,
    status: 'completed',
    conclusion: status,
    startedAt: ranAt,
    completedAt: new Date().toISOString(),
    detailsUrl: null,
  }
  return { status, checks: [check], ranAt, runner: cfg.runner, logTailPath }
}

/** Last ~4KB of a CI log — handed to the worker as fix context. */
export function ciLogTail(output: string, bytes = 4000): string {
  return output.length > bytes ? output.slice(-bytes) : output
}

function failCheck(reason: string): PRCheck[] {
  const now = new Date().toISOString()
  const check: PRCheck = {
    name: `local-ci: ${reason}`,
    status: 'completed',
    conclusion: 'failure',
    startedAt: now,
    completedAt: now,
    detailsUrl: null,
  }
  return [check]
}

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 })
    child.stdout?.on('data', (d) => { output += d })
    child.stderr?.on('data', (d) => { output += d })
    child.on('error', (err) => {
      output += `\n[local-ci] failed to start ${cmd}: ${err.message}\n`
      resolve({ code: 127, output })
    })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

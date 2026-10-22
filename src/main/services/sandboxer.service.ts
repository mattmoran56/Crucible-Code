import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { appendFile, copyFile, readFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  SandboxInfo,
  SandboxLinkState,
  SandboxTeardownReport,
  SandboxerConfigCheck,
} from '../../shared/types'

/**
 * Sandboxer (github.com/mattmoran56/sandboxer-core) turns a git worktree into a
 * running container with its own database and storage. Everything here goes
 * through its CLI — never Docker directly — so sandboxer stays the one thing
 * that knows what a sandbox owns.
 *
 * Config: sandboxer reads `sandboxer.yaml` by walking up from the worktree. Our
 * worktrees live outside the repo, so a config the repo keeps out of git (e.g.
 * in `.git/info/exclude`) never reaches them; `prepareWorktree` copies it in.
 *
 * Teardown: `sandboxer down` removes the container, its volumes (database,
 * uploads) and its generated host files — but only while the worktree and its
 * config still exist. So sessions tear sandboxes down *before* git removes the
 * worktree, and anything that slips through is reaped by `sandboxer gc`, which
 * handles sandboxes whose worktree is gone.
 */

export const CONFIG_FILENAME = 'sandboxer.yaml'
/** Every spelling sandboxer accepts, in its own order of preference. */
const CONFIG_FILENAMES = [CONFIG_FILENAME, 'sandboxer.yml', '.sandboxer.yaml']
/** Our worktrees all sit under a directory with this name (worktree.service). */
const WORKTREES_SEGMENT = `${sep}.codecrucible-worktrees${sep}`

type Run = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number }
) => Promise<string>

const defaultRun: Run = (cmd, args, opts = {}) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // sandboxer prints its human-readable reason on stderr.
          const detail = String(stderr || '').trim() || err.message
          reject(new Error(detail))
          return
        }
        resolvePromise(String(stdout))
      }
    )
  })

let run: Run = defaultRun

/** Test seam: swap the process runner. Pass nothing to restore the default. */
export function setRunnerForTests(fn?: Run): void {
  run = fn ?? defaultRun
}

function sandboxer(args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<string> {
  // A cwd that no longer exists makes execFile fail before sandboxer runs.
  const cwd = opts?.cwd && existsSync(opts.cwd) ? opts.cwd : homedir()
  return run('sandboxer', [...args, '--json'], { ...opts, cwd })
}

function canonical(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b) || canonical(a) === canonical(b)
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(canonical(parent), canonical(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Where a project's config lives: relative to the repo root, `~/`, or absolute. */
export function resolveConfigPath(repoPath: string, configPath?: string): string {
  const p = configPath?.trim()
  if (!p) return join(repoPath, CONFIG_FILENAME)
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1))
  return isAbsolute(p) ? p : resolve(repoPath, p)
}

/** `sandboxer version`, or null when the CLI is not on PATH. */
export async function cliVersion(): Promise<string | null> {
  try {
    const out = JSON.parse(await sandboxer(['version'], { timeoutMs: 15_000 }))
    return typeof out?.version === 'string' ? out.version : null
  } catch {
    return null
  }
}

async function gitSucceeds(cwd: string, args: string[]): Promise<boolean> {
  try {
    await run('git', args, { cwd, timeoutMs: 15_000 })
    return true
  } catch {
    return false
  }
}

/** Does the config exist, is the CLI installed, and how does git see the file? */
export async function checkConfig(repoPath: string, configPath?: string): Promise<SandboxerConfigCheck> {
  const path = resolveConfigPath(repoPath, configPath)
  const exists = existsSync(path)
  let gitState: SandboxerConfigCheck['gitState'] = 'unknown'
  if (!isInside(repoPath, path)) {
    gitState = 'outside-repo'
  } else {
    const rel = relative(canonical(repoPath), canonical(path))
    if (await gitSucceeds(repoPath, ['ls-files', '--error-unmatch', '--', rel])) gitState = 'tracked'
    else if (await gitSucceeds(repoPath, ['check-ignore', '-q', '--', rel])) gitState = 'ignored'
    else if (exists) gitState = 'untracked'
  }
  return { path, exists, gitState, cliVersion: await cliVersion() }
}

/**
 * Make sure sandboxer can find a config from inside this worktree.
 *
 * A worktree that tracks its own config is left alone — the repo has said how it
 * runs. Otherwise the project's config is copied to `<worktree>/sandboxer.yaml`
 * (every time, so edits to the source reach the next `up`) and kept out of git
 * via the repo's shared `info/exclude`, so it can never be committed by accident.
 */
export async function prepareWorktree(
  repoPath: string,
  worktreePath: string,
  configPath?: string
): Promise<{ copied: boolean; source: string }> {
  const source = resolveConfigPath(repoPath, configPath)
  const tracked = await run('git', ['ls-files', '--', ...CONFIG_FILENAMES], {
    cwd: worktreePath,
    timeoutMs: 15_000,
  }).catch(() => '')
  if (tracked.trim()) return { copied: false, source: join(worktreePath, tracked.trim().split('\n')[0]) }

  if (!existsSync(source)) {
    throw new Error(`No Sandboxer config at ${source}. Set its path in Settings → Sandboxer.`)
  }
  const dest = join(worktreePath, CONFIG_FILENAME)
  if (!samePath(source, dest)) await copyFile(source, dest)

  if (!(await gitSucceeds(worktreePath, ['check-ignore', '-q', '--', CONFIG_FILENAME]))) {
    const commonDir = (
      await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: worktreePath,
        timeoutMs: 15_000,
      })
    ).trim()
    const exclude = join(commonDir, 'info', 'exclude')
    const current = await readFile(exclude, 'utf8').catch(() => '')
    const prefix = current === '' || current.endsWith('\n') ? '' : '\n'
    await appendFile(
      exclude,
      `${prefix}# Sandboxer config copied into worktrees by Crucible Code (local only)\n/${CONFIG_FILENAME}\n`
    )
  }
  return { copied: true, source }
}

function parseSandboxes(stdout: string): SandboxInfo[] {
  const parsed = JSON.parse(stdout || '[]')
  return Array.isArray(parsed) ? (parsed as SandboxInfo[]) : []
}

/** Every sandbox on the machine. Throws when sandboxer or Docker is unavailable. */
export async function listAll(): Promise<SandboxInfo[]> {
  return parseSandboxes(await sandboxer(['ls'], { timeoutMs: 30_000 }))
}

/** The sandboxes built from this worktree (normally zero or one). */
export async function listForWorktree(worktreePath: string): Promise<SandboxInfo[]> {
  return (await listAll()).filter((s) => !!s.worktree && samePath(s.worktree, worktreePath))
}

/**
 * Does a sandbox URL answer yet? Asked of the URL itself because sandboxer only
 * reports readiness for backends, not front-ends. What the answers mean:
 * - 502/504 or no connection: the sandbox's Caddy is up but the app is not.
 * - 503 "has not been built": a front-end sandboxer has not built yet.
 * - 404 not via Caddy: Traefik has no route yet (the container is starting).
 * - anything else, including an app's own 404 on `/`: ready.
 * Certificates are not checked: these are sandboxer's own loopback hostnames,
 * often signed by a local mkcert CA that Node does not trust.
 */
export function probeUrl(url: string, timeoutMs = 4_000): Promise<SandboxLinkState> {
  return new Promise((resolvePromise) => {
    let settled = false
    const done = (state: SandboxLinkState) => {
      if (settled) return
      settled = true
      resolvePromise(state)
      req.destroy()
    }
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolvePromise('starting')
      return
    }
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(target, { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false }, (res: IncomingMessage) => {
      const code = res.statusCode ?? 0
      const viaCaddy = /caddy/i.test(`${res.headers.server ?? ''} ${res.headers.via ?? ''}`)
      if (code === 503) {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          if (body.length > 4_096) done(/has not been built/.test(body) ? 'not-built' : 'starting')
        })
        res.on('end', () => done(/has not been built/.test(body) ? 'not-built' : 'starting'))
        res.on('error', () => done('starting'))
        return
      }
      if (code === 0 || code === 502 || code === 504 || (code === 404 && !viaCaddy)) done('starting')
      else done('ready')
    })
    req.on('timeout', () => done('starting'))
    req.on('error', () => done('starting'))
    req.end()
  })
}

let probe: (url: string) => Promise<SandboxLinkState> = (url) => probeUrl(url)

/** Test seam: swap the URL probe. Pass nothing to restore the default. */
export function setProbeForTests(fn?: (url: string) => Promise<SandboxLinkState>): void {
  probe = fn ?? ((url) => probeUrl(url))
}

/** Sandboxes for this worktree with their URLs and whether each one answers yet. */
export async function status(worktreePath: string): Promise<SandboxInfo[]> {
  const sandboxes = await listForWorktree(worktreePath)
  return Promise.all(
    sandboxes.map(async (s) => {
      let info: SandboxInfo = s
      try {
        const detail = JSON.parse(
          await sandboxer(['status', s.slug, '--project', s.project], { cwd: worktreePath, timeoutMs: 30_000 })
        ) as SandboxInfo
        info = { ...s, ...detail }
      } catch {
        return s
      }
      const entries = Object.entries(info.urls ?? {})
      const states = await Promise.all(entries.map(([, url]) => probe(url)))
      return { ...info, links: Object.fromEntries(entries.map(([label], i) => [label, states[i]])) }
    })
  )
}

export async function stop(sb: Pick<SandboxInfo, 'project' | 'slug' | 'worktree'>): Promise<void> {
  await sandboxer(['stop', sb.slug, '--project', sb.project], { cwd: sb.worktree })
}

export async function start(sb: Pick<SandboxInfo, 'project' | 'slug' | 'worktree'>): Promise<void> {
  await sandboxer(['start', sb.slug, '--project', sb.project], { cwd: sb.worktree, timeoutMs: 300_000 })
}

/** `sandboxer down`: the container, its database, its uploads and its host files. */
export async function down(sb: Pick<SandboxInfo, 'project' | 'slug' | 'worktree'>): Promise<void> {
  await sandboxer(['down', sb.slug, '--project', sb.project], { cwd: sb.worktree, timeoutMs: 180_000 })
}

/**
 * `sandboxer gc`: reaps every sandbox whose worktree no longer exists, volumes
 * nothing owns, and images a newer build replaced. All sandboxer-owned; it does
 * not touch the build cache or anything outside sandboxer.
 */
export async function gc(): Promise<void> {
  await sandboxer(['gc'], { timeoutMs: 600_000 })
}

/**
 * Destroy every sandbox built from this worktree, with its data. Call while the
 * worktree still exists — `down` needs the worktree's config.
 */
export async function teardownForWorktree(worktreePath: string): Promise<SandboxTeardownReport> {
  const report: SandboxTeardownReport = { removed: [], failed: [] }
  let sandboxes: SandboxInfo[]
  try {
    sandboxes = await listForWorktree(worktreePath)
  } catch (err) {
    report.skipped = err instanceof Error ? err.message : String(err)
    return report
  }
  for (const sb of sandboxes) {
    const id = `${sb.project}/${sb.slug}`
    try {
      await down(sb)
      report.removed.push(id)
    } catch (err) {
      report.failed.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return report
}

/**
 * After the worktree is gone: if any sandbox still points at it, reap it with
 * `gc` (which, unlike `down`, works without the worktree) and check again.
 * Returns the sandboxes that survived both — which should be none.
 */
export async function reapAfterRemoval(worktreePath: string): Promise<SandboxInfo[]> {
  let remaining: SandboxInfo[]
  try {
    remaining = await listForWorktree(worktreePath)
  } catch {
    return []
  }
  if (remaining.length === 0) return []
  try {
    await gc()
  } catch {
    // Checked below.
  }
  try {
    return await listForWorktree(worktreePath)
  } catch {
    return remaining
  }
}

/**
 * Sweep for sandboxes left behind by our own sessions — a worktree under
 * `.codecrucible-worktrees` that no longer exists (Docker was down when the
 * session was deleted, the app quit mid-delete, ...). Only runs `gc` when there
 * is one, so a machine with no strays is never touched. Best-effort.
 */
export async function reapOrphanedSessionSandboxes(): Promise<string[]> {
  let orphans: SandboxInfo[]
  try {
    orphans = (await listAll()).filter(
      (s) => !!s.worktree && s.worktree.includes(WORKTREES_SEGMENT) && !existsSync(s.worktree)
    )
  } catch {
    return []
  }
  if (orphans.length === 0) return []
  try {
    await gc()
  } catch {
    return []
  }
  return orphans.map((s) => `${s.project}/${s.slug}`)
}

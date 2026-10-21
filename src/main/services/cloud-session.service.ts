/**
 * Cloud sessions: run a session's agent in Claude Code on the web instead of
 * on this machine, watch it from the Agent tab, and teleport it down to the
 * session's worktree when it is time to test locally.
 *
 * - create: push the session branch (the cloud VM clones the CURRENT branch of
 *   the cwd's GitHub remote, falling back to the default branch when it is not
 *   on GitHub), then `claude -p <prompt> --cloud --on-branch <branch>
 *   --output-format json`. `--on-branch` makes the cloud agent check out and
 *   push to that exact branch (the app owns the branch name) instead of a
 *   generated `claude/...` one; the prompt also says so, which is all that
 *   steers it on a CLI too old for `--on-branch` (we retry without the flag).
 * - send: `claude -p <msg> --cloud <id> --output-format json` queues a
 *   follow-up (stream-json is not supported with --cloud).
 * - teleport: `claude --teleport <id>` in a PTY, in the worktree. Interactive
 *   only, needs a clean tree; afterwards it is a normal local Claude session.
 *
 * PERMISSIONS (CLAUDE.md, non-negotiable): never `--dangerously-skip-permissions`
 * and never any `--permission-mode`. Every argv spreads
 * `AUTO_PERMISSION_MODE_ARGS` (empty) so the CLI inherits the user's default.
 *
 * Every process is spawned from an argv array — user prompts are never
 * interpolated into a shell. The PTY command (teleport) carries only a
 * validated session id, and is shell-quoted regardless.
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CloudSessionResult } from '../../shared/types'
import { validateBranchName } from '../../shared/branch-name'
import { AUTO_PERMISSION_MODE_ARGS, shellQuote } from './terminal.service'

/** How long a `-p --cloud` call may take before we give up on it. */
export const CLOUD_CALL_TIMEOUT_MS = 5 * 60_000

/** Cloud session ids look like `session_01AbC...`; be permissive but shell-safe. */
const CLOUD_ID = /^[A-Za-z0-9_-]{3,200}$/
const CLOUD_URL = /https:\/\/claude\.ai\/code\/[A-Za-z0-9_\-/?=&.%]+/
const CLOUD_ID_IN_TEXT = /\b(session_[A-Za-z0-9_-]{6,})\b/

export const isValidCloudSessionId = (id: unknown): id is string =>
  typeof id === 'string' && CLOUD_ID.test(id)

export const isCloudSessionUrl = (url: unknown): url is string =>
  typeof url === 'string' && /^https:\/\/claude\.ai\//.test(url)

/**
 * A prompt as a single argv element. A leading `-` would be parsed as a flag,
 * so it gets a leading space (harmless to the model).
 */
const promptArg = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.startsWith('-') ? ` ${trimmed}` : trimmed
}

/* --- argv builders (pure) -------------------------------------------------- */

const assertBranch = (branch: string): void => {
  const invalid = validateBranchName(branch)
  if (invalid) throw new Error(`Invalid branch name "${branch}": ${invalid}`)
}

/** `--on-branch <branch>` pins the cloud session to that branch (checkout + push). */
export const cloudCreateArgv = (prompt: string, branch?: string): string[] => {
  if (branch !== undefined) assertBranch(branch)
  return [
    '-p',
    promptArg(prompt),
    '--cloud',
    ...(branch ? ['--on-branch', branch] : []),
    '--output-format',
    'json',
    ...AUTO_PERMISSION_MODE_ARGS,
  ]
}

/** Prepend an instruction telling the cloud agent to work on, and push to, exactly `branch`. */
export const withBranchInstruction = (prompt: string, branch: string): string =>
  `Work on the git branch \`${branch}\` (already checked out for you). Commit your changes and push them to exactly that branch (\`git push origin ${branch}\`); do not create or push to any other branch.\n\n${prompt}`

/** True when claude rejected `--on-branch` as an unknown option (older CLI). */
export const isUnknownOnBranchError = (text: string): boolean =>
  /(unknown|unrecognized) (option|argument|flag)[^\n]*--on-branch/i.test(text)

export const cloudSendArgv = (cloudSessionId: string, message: string): string[] => {
  if (!isValidCloudSessionId(cloudSessionId)) throw new Error('Invalid cloud session id')
  return ['-p', promptArg(message), '--cloud', cloudSessionId, '--output-format', 'json', ...AUTO_PERMISSION_MODE_ARGS]
}

export const teleportArgv = (cloudSessionId: string): string[] => {
  if (!isValidCloudSessionId(cloudSessionId)) throw new Error('Invalid cloud session id')
  return ['--teleport', cloudSessionId, ...AUTO_PERMISSION_MODE_ARGS]
}

/** `claude <argv>` as a shell body for a `command`-mode PTY. */
export const claudeShellCommand = (argv: string[]): string =>
  ['claude', ...argv].map(shellQuote).join(' ')

/* --- output parsing (pure) ------------------------------------------------- */

const asString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

function fromJsonObject(obj: Record<string, unknown>): { result?: CloudSessionResult; error?: string } {
  const sessionId = asString(obj.session_id) ?? asString(obj.sessionId) ?? asString(obj.id)
  const url = asString(obj.url) ?? asString(obj.session_url)
  const okFlag = obj.ok
  const error =
    asString(obj.error) ??
    asString((obj.error as Record<string, unknown> | undefined)?.message) ??
    asString(obj.message)
  if (okFlag === false || obj.is_error === true) return { error: error ?? 'Claude reported a failure' }
  if (sessionId && isValidCloudSessionId(sessionId)) {
    return { result: { sessionId, url: url && isCloudSessionUrl(url) ? url : cloudUrlFor(sessionId) } }
  }
  return error ? { error } : {}
}

/** The web URL for a session id, when Claude did not hand one back. */
export const cloudUrlFor = (sessionId: string): string => `https://claude.ai/code/${sessionId}`

/**
 * Pull `{sessionId, url}` out of a `-p --cloud --output-format json` run.
 * Tries the whole stdout as JSON, then each line, then falls back to scanning
 * the text for a claude.ai/code URL or a `session_` id. Throws with the most
 * useful message it can find when nothing matches.
 */
export function parseCloudResult(stdout: string, stderr = ''): CloudSessionResult {
  const candidates: string[] = [stdout.trim(), ...stdout.split('\n').map((l) => l.trim())].filter(Boolean)
  let reported: string | null = null
  for (const text of candidates) {
    if (!text.startsWith('{')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const { result, error } = fromJsonObject(parsed as Record<string, unknown>)
    if (result) return result
    if (error && !reported) reported = error
  }
  if (reported) throw new Error(reported)

  const all = `${stdout}\n${stderr}`
  const url = all.match(CLOUD_URL)?.[0] ?? null
  const fromUrl = url ? url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() ?? null : null
  const id = all.match(CLOUD_ID_IN_TEXT)?.[1] ?? (fromUrl && isValidCloudSessionId(fromUrl) ? fromUrl : null)
  if (id) return { sessionId: id, url: url ?? cloudUrlFor(id) }

  const detail = (stderr.trim() || stdout.trim()).split('\n').slice(-5).join('\n')
  throw new Error(detail ? `Claude did not return a cloud session: ${detail}` : 'Claude did not return a cloud session')
}

/* --- process plumbing ------------------------------------------------------ */

/** Same CLAUDE_CONFIG_DIR rules as the visual agent / terminals. */
export function cloudEnv(configDir?: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (configDir) {
    env.CLAUDE_CONFIG_DIR = configDir.startsWith('~/') ? join(homedir(), configDir.slice(2)) : configDir
  } else {
    delete env.CLAUDE_CONFIG_DIR
  }
  return env
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runClaude(argv: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('claude', argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      reject(err)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* already gone */ }
      reject(new Error('Timed out waiting for Claude to start the cloud session'))
    }, timeoutMs)
    child.stdout?.on('data', (d) => { stdout += String(d) })
    child.stderr?.on('data', (d) => { stderr += String(d) })
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err.code === 'ENOENT' ? new Error('The `claude` CLI was not found on PATH') : err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || '').trim() || err.message
        reject(new Error(detail))
        return
      }
      resolve(String(stdout))
    })
  })
}

/** Push the session branch so the cloud VM clones it rather than the default branch. */
export async function pushSessionBranch(worktreePath: string, branch: string): Promise<void> {
  assertBranch(branch)
  try {
    await git(worktreePath, ['push', '-u', 'origin', branch])
  } catch (err) {
    throw new Error(`Could not push ${branch} to GitHub: ${(err as Error).message}`)
  }
}

/**
 * Files that would block a teleport. Our own hook settings file is ignored —
 * we write it into every worktree and it is not the user's work.
 */
export const IGNORED_DIRTY_PATHS = new Set(['.claude/settings.local.json'])

export function parsePorcelain(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim())
    .map((l) => l.slice(3).replace(/^"|"$/g, ''))
    .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))
    .filter((p) => !IGNORED_DIRTY_PATHS.has(p))
}

export async function worktreeDirtyFiles(worktreePath: string): Promise<string[]> {
  return parsePorcelain(await git(worktreePath, ['status', '--porcelain']))
}

/* --- public API ------------------------------------------------------------ */

export interface CreateCloudSessionOptions {
  worktreePath: string
  branch: string
  prompt: string
  configDir?: string | null
}

export async function createCloudSession(opts: CreateCloudSessionOptions): Promise<CloudSessionResult> {
  const prompt = opts.prompt?.trim()
  if (!prompt) throw new Error('A cloud session needs a task description to start')
  await pushSessionBranch(opts.worktreePath, opts.branch)
  const fullPrompt = withBranchInstruction(prompt, opts.branch)
  const env = cloudEnv(opts.configDir)
  let run = await runClaude(cloudCreateArgv(fullPrompt, opts.branch), opts.worktreePath, env, CLOUD_CALL_TIMEOUT_MS)
  if (run.code !== 0 && isUnknownOnBranchError(`${run.stderr}\n${run.stdout}`)) {
    // Older CLI without --on-branch: the VM still clones the branch we just
    // pushed (it is the worktree's current branch) and the prompt steers it.
    run = await runClaude(cloudCreateArgv(fullPrompt), opts.worktreePath, env, CLOUD_CALL_TIMEOUT_MS)
  }
  try {
    return { ...parseCloudResult(run.stdout, run.stderr), branch: opts.branch }
  } catch (err) {
    if (run.code !== 0 && run.code !== null) {
      throw new Error(`${(err as Error).message} (claude exited with code ${run.code})`)
    }
    throw err
  }
}

export interface SendCloudMessageOptions {
  worktreePath: string
  cloudSessionId: string
  message: string
  configDir?: string | null
}

export async function sendCloudMessage(opts: SendCloudMessageOptions): Promise<CloudSessionResult> {
  const message = opts.message?.trim()
  if (!message) throw new Error('Message is empty')
  const run = await runClaude(
    cloudSendArgv(opts.cloudSessionId, message),
    opts.worktreePath,
    cloudEnv(opts.configDir),
    CLOUD_CALL_TIMEOUT_MS
  )
  return parseCloudResult(run.stdout, run.stderr)
}

/* --- teleported session discovery ------------------------------------------ */

/** Claude Code's projects/ directory name for a cwd: every non-alphanumeric → '-'. */
export const encodeProjectDir = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

export const claudeConfigRoot = (configDir?: string | null): string => {
  if (!configDir) return join(homedir(), '.claude')
  return configDir.startsWith('~/') ? join(homedir(), configDir.slice(2)) : configDir
}

/** Slack for clock/mtime granularity between teleportedAt and the first write. */
const DISCOVERY_SLACK_MS = 5_000
const LOCAL_SESSION_ID = /^[A-Za-z0-9-]+$/

export interface DiscoverOptions {
  worktreePath: string
  configDir?: string | null
  /** ISO time the teleport started. */
  since: string
}

/**
 * The local Claude session a teleport created: the newest transcript `.jsonl`
 * under `<config>/projects/<encoded worktree>/` written at/after `since`.
 * Returns null when nothing qualifies.
 */
export async function discoverTeleportedSession(opts: DiscoverOptions): Promise<string | null> {
  const sinceMs = Date.parse(opts.since)
  if (!Number.isFinite(sinceMs)) return null
  const root = join(claudeConfigRoot(opts.configDir), 'projects')
  const cwds = new Set([opts.worktreePath])
  try {
    cwds.add(await fs.realpath(opts.worktreePath))
  } catch {
    // Worktree gone; the raw path is all we have.
  }
  let best: { id: string; mtime: number } | null = null
  for (const cwd of cwds) {
    const dir = join(root, encodeProjectDir(cwd))
    let names: string[]
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const id = name.slice(0, -'.jsonl'.length)
      if (!LOCAL_SESSION_ID.test(id)) continue
      let mtime: number
      try {
        mtime = (await fs.stat(join(dir, name))).mtimeMs
      } catch {
        continue
      }
      if (mtime < sinceMs - DISCOVERY_SLACK_MS) continue
      if (!best || mtime > best.mtime) best = { id, mtime }
    }
  }
  return best?.id ?? null
}

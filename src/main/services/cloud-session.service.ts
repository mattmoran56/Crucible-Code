/**
 * Cloud sessions: run a session's agent in Claude Code on the web instead of
 * on this machine, watch it from the Agent tab, and teleport it down to the
 * session's worktree when it is time to test locally.
 *
 * - create: push the session branch (the cloud VM clones the CURRENT branch of
 *   the cwd's GitHub remote), then run `claude --cloud <task> --on-branch
 *   <branch>` INTERACTIVELY in a PTY shown in the session's Agent tab. Starting
 *   a new cloud session is interactive-only (the CLI refuses `--cloud` with
 *   `--print`, and refuses to start one without a TTY), and it may ask
 *   questions (forward settings / MCP servers, re-register this machine, sign
 *   in) — the user answers them in that terminal. We watch the PTY output for
 *   the new session's claude.ai/code URL / id (`findCloudSessionInOutput`).
 *   `--on-branch` makes the cloud agent check out and push to exactly the
 *   app's branch; the task text also says so, which is all that steers it on
 *   a CLI that rejects `--on-branch` (we retry without the flag).
 * - send: `claude -p <msg> --cloud <id> --output-format json` queues a
 *   follow-up to an EXISTING session (valid with --print).
 * - teleport: `claude --teleport <id>` in a PTY, in the worktree, watched by
 *   cloud-teleport.service until the conversation is saved locally; then the
 *   PTY is closed and the Agent tab resumes it as a visual agent. Needs a
 *   clean tree. (`--teleport` is accepted with `-p` too, but there it fails
 *   hard on prompts and writes no transcript until the first new turn.)
 *
 * PERMISSIONS (CLAUDE.md, non-negotiable): never `--dangerously-skip-permissions`
 * and never any `--permission-mode`. Every argv spreads
 * `AUTO_PERMISSION_MODE_ARGS` (empty) so the CLI inherits the user's default.
 *
 * Headless processes are spawned from an argv array. PTY commands go through
 * `sh -lc`, so every argv element is POSIX single-quoted (`shellQuote`) — the
 * task text can contain anything and is never interpreted by the shell. (The
 * task cannot go through a heredoc/stdin: `--cloud` takes it as its value and
 * refuses piped stdin.)
 */
import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CloudSessionResult } from '../../shared/types'
import { validateBranchName } from '../../shared/branch-name'
import { AUTO_PERMISSION_MODE_ARGS, shellQuote } from './terminal.service'
import { scrubInheritedClaudeSession } from './claude-env'

/** How long a `-p --cloud <id>` call may take before we give up on it. */
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

/**
 * Interactive create: `claude --cloud <task> [--on-branch <branch>]`. The task
 * is `--cloud`'s value (a positional prompt is refused alongside it).
 * `--on-branch` pins the cloud session to that branch (checkout + push).
 */
export const cloudStartArgv = (prompt: string, branch?: string): string[] => {
  if (branch !== undefined) assertBranch(branch)
  const task = promptArg(prompt)
  if (!task.trim()) throw new Error('A cloud session needs a task description to start')
  return ['--cloud', task, ...(branch ? ['--on-branch', branch] : []), ...AUTO_PERMISSION_MODE_ARGS]
}

/** Prepend an instruction telling the cloud agent to work on, and push to, exactly `branch`. */
export const withBranchInstruction = (prompt: string, branch: string): string =>
  `Work on the git branch \`${branch}\` (already checked out for you). Commit your changes and push them to exactly that branch (\`git push origin ${branch}\`); do not create or push to any other branch.\n\n${prompt}`

/**
 * Prepend an instruction for an orchestrator cloud session: it starts on
 * `branch` but may create, check out, merge and push whatever branches the
 * task needs.
 */
export const withOrchestratorInstruction = (prompt: string, branch: string): string =>
  `You are an orchestrator session. You start on the git branch \`${branch}\`, but you are not limited to it: create, check out, merge and push to whichever branches the task needs, and split the work across branches where that helps. When you finish, list every branch you created or pushed and what is on each.\n\n${prompt}`

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

/* --- interactive create: reading the PTY (pure) ---------------------------- */

/** A new cloud session id as the CLI prints it (`session_…`, or `cse_…`). */
const NEW_CLOUD_ID = /^(?:session_|cse_)[A-Za-z0-9_-]{6,184}$/

/** OSC 8 hyperlinks carry the full, unwrapped URL: ESC ] 8 ; params ; URL (BEL | ESC \\). */
const OSC8_URL = /\x1b\]8;[^;\x07\x1b]*;([^\x07\x1b]+)(?:\x07|\x1b\\)/g

/**
 * Terminal output → plain text: drop OSC strings (titles, hyperlinks), CSI
 * sequences (colours, cursor moves), other two-byte escapes and lone CRs.
 * Cursor-forward moves become a space so words do not run together.
 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*C/g, ' ')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/\r(?!\n)/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
}

const fromId = (id: string | undefined | null): CloudSessionResult | null =>
  id && NEW_CLOUD_ID.test(id) ? { sessionId: id, url: cloudUrlFor(id) } : null

const idFromUrl = (url: string): string | null => {
  const m = url.match(/^https:\/\/claude\.ai\/code\/((?:session_|cse_)[A-Za-z0-9_-]+)/)
  return m ? m[1] : null
}

/**
 * The new cloud session in the interactive `claude --cloud` output, or null.
 * The CLI prints `View: https://claude.ai/code/session_…?from=cli&m=0` (and
 * `Session ID:` / `Resume with: claude --teleport <id>`) when it creates the
 * session and exits, or `Cloud session active · code here or at <url>` when it
 * stays attached. Tolerates ANSI noise, OSC 8 links and a URL that the
 * terminal wrapped across lines.
 */
export function findCloudSessionInOutput(raw: string): CloudSessionResult | null {
  for (const m of raw.matchAll(OSC8_URL)) {
    const hit = fromId(idFromUrl(m[1]))
    if (hit) return hit
  }
  const text = stripAnsi(raw)
  // A claude.ai/code URL, possibly wrapped: the CLI always ends it with ?from=.
  const wrapped = text.match(/https:\/\/claude\.ai\/code\/((?:session_|cse_)[A-Za-z0-9_\-\s]*?)\?from=/)
  const hit =
    (wrapped && fromId(wrapped[1].replace(/\s+/g, ''))) ||
    fromId(text.match(/https:\/\/claude\.ai\/code\/((?:session_|cse_)[A-Za-z0-9_-]+)/)?.[1]) ||
    fromId(text.match(/Session ID:\s*((?:session_|cse_)[A-Za-z0-9_-]+)/)?.[1]) ||
    fromId(text.match(/--teleport\s+((?:session_|cse_)[A-Za-z0-9_-]+)/)?.[1])
  return hit || null
}

/** The last few meaningful lines of a failed create, for the error banner. */
export function summarizeCreateFailure(raw: string, maxLines = 6): string {
  const lines = stripAnsi(raw)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim())
  return lines.slice(-maxLines).join('\n').trim()
}

/** The CLI said the create request may have gone through before it was cancelled. */
export const mayHaveCreatedSession = (raw: string): boolean =>
  /a cloud session may still have been created/i.test(stripAnsi(raw))

/* --- process plumbing ------------------------------------------------------ */

/** Same CLAUDE_CONFIG_DIR rules as the visual agent / terminals. */
export function cloudEnv(configDir?: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = scrubInheritedClaudeSession({ ...process.env })
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
 * What Claude Code writes into a teleported conversation's local transcript:
 * the pulled rows are flagged `remoteSourced`, and the CLI adds an `isMeta`
 * note that the session continues from another machine (strings verified in
 * the 2.1.306 binary). Either one marks the transcript as the teleport's.
 */
export const TELEPORT_MARKERS = ['"remoteSourced":true', 'This session is being continued from another machine']

/** How much of a transcript to scan for a marker (the pulled rows come first). */
const MARKER_SCAN_BYTES = 2 * 1024 * 1024

export async function hasTeleportMarker(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(path, 'r')
    const buffer = Buffer.alloc(MARKER_SCAN_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, MARKER_SCAN_BYTES, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf-8')
    return TELEPORT_MARKERS.some((m) => text.includes(m))
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => {})
  }
}

/** The project directories Claude Code may have used for a cwd (raw and real path). */
export async function projectDirsFor(cwd: string, configDir?: string | null): Promise<string[]> {
  const root = join(claudeConfigRoot(configDir), 'projects')
  const cwds = new Set([cwd])
  try {
    cwds.add(await fs.realpath(cwd))
  } catch {
    // Worktree gone; the raw path is all we have.
  }
  return [...cwds].map((c) => join(root, encodeProjectDir(c)))
}

export interface TeleportTranscript {
  /** The local Claude session id (the file name). */
  id: string
  path: string
  size: number
  mtime: number
  /** Whether the file carries a teleport marker. */
  marked: boolean
}

/**
 * The transcript a teleport wrote: among `.jsonl` files under
 * `<config>/projects/<encoded worktree>/` written at/after `since`, the newest
 * one carrying a teleport marker — or, failing that, the newest one (older
 * CLIs may not mark it). Null when nothing qualifies.
 */
export async function findTeleportTranscript(opts: DiscoverOptions): Promise<TeleportTranscript | null> {
  const sinceMs = Date.parse(opts.since)
  if (!Number.isFinite(sinceMs)) return null
  const candidates: Omit<TeleportTranscript, 'marked'>[] = []
  for (const dir of await projectDirsFor(opts.worktreePath, opts.configDir)) {
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
      const path = join(dir, name)
      let stat: { mtimeMs: number; size: number }
      try {
        stat = await fs.stat(path)
      } catch {
        continue
      }
      if (stat.mtimeMs < sinceMs - DISCOVERY_SLACK_MS) continue
      if (candidates.some((c) => c.id === id)) continue
      candidates.push({ id, path, size: stat.size, mtime: stat.mtimeMs })
    }
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  for (const c of candidates) {
    if (await hasTeleportMarker(c.path)) return { ...c, marked: true }
  }
  return { ...candidates[0], marked: false }
}

/** The local Claude session id a teleport created, or null (see findTeleportTranscript). */
export async function discoverTeleportedSession(opts: DiscoverOptions): Promise<string | null> {
  return (await findTeleportTranscript(opts))?.id ?? null
}

/**
 * Visual Agent registry: one long-lived `claude -p --input-format stream-json`
 * process per agent, driven over stdin/stdout instead of a PTY.
 *
 * Port of meet-jef's `packages/server/src/agent-sessions.ts`, adapted from
 * `docker exec` to a local `child_process.spawn`.
 *
 * PERMISSIONS (CLAUDE.md, non-negotiable): no `--dangerously-skip-permissions`
 * and no `--permission-mode` of any kind — `AUTO_PERMISSION_MODE_ARGS` (empty)
 * only, so the CLI inherits the user's configured default (auto). The worktree
 * is prepped exactly like a terminal spawn (hook settings), and permission questions the CLI escalates arrive as
 * `control_request` `can_use_tool` on the stream and are answered by a person
 * in the UI.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, type BrowserWindow } from 'electron'
import { IPC } from '../../../shared/constants'
import {
  DEFAULT_VISUAL_AGENT_MODEL,
  type VisualAgentAskDecision,
  type VisualAgentEvent,
  type VisualAgentFork,
  type VisualAgentFrame,
  type VisualAgentRunState,
  type VisualAgentSnapshot,
  type VisualAgentStartOptions,
} from '../../../shared/visual-agent'
import type { HookType } from '../../../shared/types'
import { emitToRenderer } from '../event-bus'
import { handleHookEvent, VISUAL_AGENT_HOOK_TAB } from '../notification-server'
import { killChildTree } from '../claude-headless.service'
import { writeClaudeHookSettings } from '../hook.service'
import {
  QUESTION_TOOL,
  agentArgv,
  forkArgv,
  interruptFrame,
  isValidModel,
  permissionResponseFrame,
  questionAnswerFrame,
  resolveModel,
  setModelFrame,
  sideQuestionPreamble,
  userMessageFrame,
} from './launch'
import {
  assistantMessageIdIn,
  controlResponseIn,
  conversationIdIn,
  initModelIn,
  lineReader,
  normalise,
  partialDeltaIn,
  permissionRequestIn,
  usageIn,
  usageTotal,
  type NormaliseContext,
  type PermissionRequest,
} from './normalise'
import { TranscriptWriter, readTranscript } from './transcript-store'
import { readClaudeTranscript } from './claude-transcript'

export const MAX_LIVE_FORKS = 3
const MAX_NOISE_LINES = 20
const INTERRUPT_FALLBACK_MS = 3000
const SET_MODEL_FALLBACK_MS = 10000
const RESTART_EXIT_WAIT_MS = 3000

type Child = ChildProcessWithoutNullStreams

interface PendingControl {
  kind: 'interrupt' | 'set_model'
  model?: string
  timer: ReturnType<typeof setTimeout>
}

interface LiveFork {
  info: VisualAgentFork
  child: Child | null
}

interface LiveAgent {
  agentId: string
  opts: VisualAgentStartOptions
  model: string
  claudeSessionId: string | null
  state: VisualAgentRunState
  events: VisualAgentEvent[]
  partials: Map<string, { messageId: string; threadId: string; text: string }>
  lastPartialId: string | null
  usage: { input: number; output: number; total: number } | null
  turnStartedAt: string | null
  forks: LiveFork[]
  child: Child | null
  ctx: NormaliseContext
  asks: Map<string, PermissionRequest>
  pendingControl: Map<string, PendingControl>
  writer: TranscriptWriter
  noise: string[]
  sawJson: boolean
  stopping: boolean
  ready: Promise<void>
}

let mainWindow: BrowserWindow | null = null
const agents = new Map<string, LiveAgent>()
let controlCounter = 0

export function setVisualAgentWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function transcriptDir(): string {
  return join(app.getPath('userData'), 'visual-agents')
}

const nowIso = (): string => new Date().toISOString()
const nextRequestId = (kind: string): string => `crucible-${kind}-${Date.now()}-${++controlCounter}`

function emit(held: LiveAgent, frame: VisualAgentFrame): void {
  emitToRenderer(mainWindow, IPC.VISUAL_AGENT_FRAME, held.agentId, frame)
}

/**
 * Which tab-status event a run-state transition means, in the same vocabulary
 * as the Claude Code hooks terminals use (prompt → working, notification →
 * needs attention, stop → done). Visual agents report from their run state
 * instead of hooks: permission and AskUserQuestion prompts go over stdio
 * (`--permission-prompt-tool stdio`), so the Notification hook never fires.
 */
export function hookTypeForTransition(
  prev: VisualAgentRunState,
  next: VisualAgentRunState
): HookType | null {
  if (prev === next) return null
  // Includes needs-input → running: answering the last ask resumes the turn
  // and clears the attention dot.
  if (next === 'running') return 'prompt'
  if (next === 'needs-input') return 'notification'
  if (next === 'idle' && (prev === 'running' || prev === 'needs-input')) return 'stop'
  return null
}

/** The workspace tab an agent lives in: agentId is `${sessionId}:${tabKey}`. */
export function workspaceTabId(opts: Pick<VisualAgentStartOptions, 'agentId' | 'sessionId'>): string {
  const prefix = `${opts.sessionId}:`
  return opts.agentId.startsWith(prefix) ? opts.agentId.slice(prefix.length) : opts.agentId
}

function reportStatus(held: LiveAgent, prev: VisualAgentRunState, next: VisualAgentRunState): void {
  const hookType = hookTypeForTransition(prev, next)
  if (hookType) handleHookEvent(held.opts.sessionId, workspaceTabId(held.opts), hookType)
}

function setState(held: LiveAgent, state: VisualAgentRunState): void {
  if (held.state === state) return
  const prev = held.state
  held.state = state
  console.log(`[visual-agent] ${held.agentId}: ${prev} -> ${state}`)
  emit(held, { t: 'state', state, turnStartedAt: held.turnStartedAt })
  reportStatus(held, prev, state)
}

function pushEvents(held: LiveAgent, events: VisualAgentEvent[]): void {
  for (const event of events) {
    held.events.push(event)
    emit(held, { t: 'event', event })
  }
}

function errorEvent(held: LiveAgent, message: string): void {
  pushEvents(held, [
    { uuid: randomUUID(), seq: held.ctx.seq++, threadId: 'main', at: nowIso(), kind: 'error', message },
  ])
}

function forkSnapshot(fork: LiveFork): VisualAgentFork {
  return { ...fork.info, events: [...fork.info.events] }
}

function snapshotOf(held: LiveAgent): VisualAgentSnapshot {
  const partial = held.lastPartialId ? held.partials.get(held.lastPartialId) ?? null : null
  return {
    agentId: held.agentId,
    claudeSessionId: held.claudeSessionId,
    model: held.model,
    state: held.state,
    events: [...held.events],
    partial: partial ? { ...partial } : null,
    usage: held.usage ? { ...held.usage } : null,
    forks: held.forks.map(forkSnapshot),
    turnStartedAt: held.turnStartedAt,
  }
}

function emitForks(held: LiveAgent): void {
  emit(held, { t: 'forks', forks: held.forks.map(forkSnapshot) })
}

function isAlive(child: Child | null): child is Child {
  return !!child && child.exitCode === null && child.signalCode == null && !child.killed
}

/** Same CLAUDE_CONFIG_DIR rules as claude-headless.service / terminal.service. */
export function buildEnv(opts: VisualAgentStartOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (opts.claudeConfigDir) {
    env.CLAUDE_CONFIG_DIR = opts.claudeConfigDir.startsWith('~/')
      ? join(homedir(), opts.claudeConfigDir.slice(2))
      : opts.claudeConfigDir
  } else {
    delete env.CLAUDE_CONFIG_DIR
  }
  // The worktree's hooks still run inside this process. Tab status comes from
  // the run state (see reportStatus), so tag hook calls with a sentinel tab
  // the notification server drops rather than double-reporting.
  env.CRUCIBLE_CONTEXT_ID = opts.sessionId
  env.CRUCIBLE_TAB_ID = VISUAL_AGENT_HOOK_TAB
  return env
}

function spawnClaude(argv: string[], opts: VisualAgentStartOptions): Child {
  return spawn('claude', argv, {
    cwd: opts.cwd,
    env: buildEnv(opts),
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as Child
}

/* --- writing to the process ---------------------------------------------- */

/**
 * Write a frame to stdin, record it in the transcript, and run it through the
 * normaliser so our own lines (user messages, permission answers) become
 * events exactly the way a replay of the transcript will rebuild them.
 */
function writeOut(held: LiveAgent, frame: string): void {
  const child = held.child
  if (!isAlive(child)) throw new Error('Visual agent is not running')
  child.stdin.write(frame)
  const text = frame.trimEnd()
  const at = nowIso()
  held.writer.append('out', text, at)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return
  }
  pushEvents(held, normalise({ ...(parsed as object), timestamp: at }, held.ctx))
}

/* --- reading from the process -------------------------------------------- */

function clearPartial(held: LiveAgent, messageId: string): void {
  const partial = held.partials.get(messageId)
  if (!partial) return
  held.partials.delete(messageId)
  if (held.lastPartialId === messageId) held.lastPartialId = null
  // Empty text = "this partial is finished"; the full message event follows.
  emit(held, { t: 'partial', messageId, threadId: partial.threadId, text: '' })
}

function clearAllPartials(held: LiveAgent): void {
  for (const id of [...held.partials.keys()]) clearPartial(held, id)
}

function handleControlResponse(held: LiveAgent, requestId: string, ok: boolean, error: string | null): void {
  const pending = held.pendingControl.get(requestId)
  if (!pending) {
    if (!ok && error) emit(held, { t: 'error', message: `The session refused that: ${error}` })
    return
  }
  clearTimeout(pending.timer)
  held.pendingControl.delete(requestId)
  if (pending.kind === 'interrupt') {
    if (!ok) interruptBySignal(held)
    return
  }
  if (pending.kind === 'set_model' && pending.model) {
    if (ok) {
      held.model = pending.model
      emit(held, { t: 'session', claudeSessionId: held.claudeSessionId ?? '', model: held.model })
    } else {
      void restartWithModel(held, pending.model)
    }
  }
}

function handleLine(held: LiveAgent, parsed: unknown, raw: string): void {
  held.sawJson = true
  held.writer.append('in', raw)

  const control = controlResponseIn(parsed)
  if (control) handleControlResponse(held, control.requestId, control.ok, control.error)

  const conversation = conversationIdIn(parsed)
  if (conversation && conversation !== held.claudeSessionId) {
    held.claudeSessionId = conversation
    held.writer.setSessionId(conversation)
    emit(held, { t: 'session', claudeSessionId: conversation, model: held.model })
  }

  const announced = initModelIn(parsed)
  if (announced && announced !== held.model) {
    held.model = announced
    emit(held, { t: 'session', claudeSessionId: held.claudeSessionId ?? '', model: announced })
  }

  const asked = permissionRequestIn(parsed)
  if (asked) {
    held.asks.set(asked.id, asked)
  }

  const usage = usageIn(parsed)
  if (usage) {
    held.usage = { input: usage.input, output: usage.output, total: usageTotal(usage) }
    emit(held, { t: 'usage', usage: held.usage })
  }

  const delta = partialDeltaIn(parsed)
  if (delta) {
    const current = held.partials.get(delta.messageId)
    const next = {
      messageId: delta.messageId,
      threadId: delta.threadId,
      text: (current?.text ?? '') + delta.text,
    }
    held.partials.set(delta.messageId, next)
    held.lastPartialId = delta.messageId
    emit(held, { t: 'partial', ...next })
    return
  }

  const finishedMessage = assistantMessageIdIn(parsed)
  if (finishedMessage) clearPartial(held, finishedMessage)

  const events = normalise(parsed, held.ctx)
  pushEvents(held, events)

  if (asked) setState(held, 'needs-input')

  for (const event of events) {
    if (event.kind === 'result' && event.threadId === 'main') {
      held.asks.clear()
      clearAllPartials(held)
      held.turnStartedAt = null
      // Always emit: turnStartedAt changed even if state did not.
      const prev = held.state
      held.state = 'idle'
      console.log(`[visual-agent] ${held.agentId}: turn finished (${prev} -> idle)`)
      emit(held, { t: 'state', state: 'idle', turnStartedAt: null })
      reportStatus(held, prev, 'idle')
    }
  }
}

/* --- process lifecycle ---------------------------------------------------- */

function spawnMain(held: LiveAgent): void {
  const argv = agentArgv({ model: held.model, resume: held.claudeSessionId })
  held.noise = []
  held.sawJson = false
  held.stopping = false
  const child = spawnClaude(argv, held.opts)
  held.child = child
  held.turnStartedAt = null
  setState(held, 'starting')

  const reader = lineReader(
    (parsed, raw) => {
      if (held.child === child) handleLine(held, parsed, raw)
    },
    (raw) => {
      if (held.noise.length < MAX_NOISE_LINES) held.noise.push(raw)
    }
  )

  // Ready to type as soon as the process exists: with --input-format
  // stream-json the CLI says nothing (no init) until the first message. A
  // successful spawn has its pid synchronously, so the snapshot `start`
  // returns is already idle; the 'spawn' event covers anything slower. A
  // failed spawn (e.g. ENOENT) has no pid and lands in 'failed' via 'error'.
  if (typeof child.pid === 'number') setState(held, 'idle')
  child.on('spawn', () => {
    if (held.child === child && held.state === 'starting') setState(held, 'idle')
  })
  child.stdout.on('data', (chunk: Buffer) => reader.push(chunk.toString('utf-8')))
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf-8').split('\n')) {
      const trimmed = line.trim()
      if (trimmed && held.noise.length < MAX_NOISE_LINES) held.noise.push(trimmed)
    }
  })
  child.stdin.on?.('error', () => {
    // EPIPE after the process died; the exit handler reports it.
  })
  child.on('error', (err: Error) => {
    if (held.child !== child) return
    errorEvent(held, `Could not start Claude Code: ${err.message}`)
    held.child = null
    setState(held, 'failed')
  })
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    reader.flush()
    if (held.child !== child) return // replaced by a restart
    held.child = null
    for (const pending of held.pendingControl.values()) clearTimeout(pending.timer)
    held.pendingControl.clear()
    held.asks.clear()
    clearAllPartials(held)
    held.turnStartedAt = null
    const clean = held.stopping || code === 0
    if (!clean) {
      const detail = held.noise.length > 0 ? `: ${held.noise.join('\n').slice(0, 2000)}` : ''
      const how = signal ? `was killed by ${signal}` : `exited with code ${code}`
      errorEvent(
        held,
        held.sawJson
          ? `Claude Code ${how}${detail}`
          : `Claude Code ${how} without starting a session${detail || ', and printed nothing.'}`
      )
    }
    setState(held, clean ? 'done' : 'failed')
  })
}

function waitForExit(child: Child, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (!isAlive(child)) return resolve()
    const timer = setTimeout(() => {
      killChildTree(child, 'SIGKILL')
      resolve()
    }, ms)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Restart the process on a new model, resuming the conversation. */
async function restartWithModel(held: LiveAgent, model: string): Promise<void> {
  held.model = model
  const old = held.child
  held.child = null
  if (old) {
    killChildTree(old)
    await waitForExit(old, RESTART_EXIT_WAIT_MS)
  }
  spawnMain(held)
  emit(held, { t: 'session', claudeSessionId: held.claudeSessionId ?? '', model })
}

function interruptBySignal(held: LiveAgent): void {
  const child = held.child
  if (!isAlive(child)) return
  try {
    child.kill('SIGINT')
  } catch {
    // Already gone.
  }
}

/* --- replay --------------------------------------------------------------- */

async function replayInto(held: LiveAgent, claudeSessionId: string): Promise<void> {
  let entries = await readTranscript(transcriptDir(), claudeSessionId)
  if (entries.length === 0) {
    // A conversation we never ran (teleported down from the cloud, or started
    // in a terminal): rebuild its history from Claude Code's own transcript,
    // and seed our store with it so later resumes keep the whole history.
    entries = await readClaudeTranscript(claudeSessionId, held.opts.cwd, held.opts.claudeConfigDir)
    for (const entry of entries) held.writer.append(entry.dir, entry.line, entry.at || undefined)
  }
  if (entries.length === 0) return
  const ctx: NormaliseContext = {
    seq: held.ctx.seq,
    fallbackId: randomUUID,
    now: nowIso,
    replayed: true,
    lastSession: null,
  }
  for (const entry of entries) {
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.line)
    } catch {
      continue
    }
    const at = entry.at || nowIso()
    ctx.now = () => at
    const usage = usageIn(parsed)
    if (usage) held.usage = { input: usage.input, output: usage.output, total: usageTotal(usage) }
    const model = initModelIn(parsed)
    if (model) held.model = model
    const stamped =
      entry.dir === 'out' && parsed && typeof parsed === 'object'
        ? { ...(parsed as object), timestamp: at }
        : parsed
    held.events.push(...normalise(stamped, ctx))
  }
  held.ctx.seq = ctx.seq
  held.ctx.lastSession = ctx.lastSession
}

/* --- public API ----------------------------------------------------------- */

export async function startVisualAgent(opts: VisualAgentStartOptions): Promise<VisualAgentSnapshot> {
  if (!opts || typeof opts.agentId !== 'string' || !opts.agentId) throw new Error('agentId is required')
  if (typeof opts.cwd !== 'string' || !opts.cwd) throw new Error('cwd is required')

  const existing = agents.get(opts.agentId)
  if (existing) {
    await existing.ready
    // A stop is in flight (e.g. Restart): let the old process go before respawning.
    if (existing.stopping && existing.child && isAlive(existing.child)) await waitForExit(existing.child, 3000)
    if (isAlive(existing.child) || (existing.state === 'starting' && existing.child)) return snapshotOf(existing)
    if (opts.fresh) {
      // "Clear": a new Claude conversation on the same agent id.
      existing.claudeSessionId = null
      existing.events = []
      existing.partials.clear()
      existing.lastPartialId = null
      existing.usage = null
      existing.forks = []
      existing.asks.clear()
      existing.ctx.lastSession = null
      existing.writer = new TranscriptWriter(transcriptDir())
    }
    // The process ended (stopped, crashed, or app restarted it away): bring it
    // back on the same conversation without replaying what we already hold.
    existing.opts = { ...existing.opts, ...opts, fresh: undefined, initialPrompt: null }
    if (opts.model && isValidModel(opts.model)) existing.model = opts.model
    prepWorktree(existing.opts)
    spawnMain(existing)
    return snapshotOf(existing)
  }

  const resumeId = opts.resumeClaudeSessionId || null
  const held: LiveAgent = {
    agentId: opts.agentId,
    opts,
    model: resolveModel(opts.model ?? DEFAULT_VISUAL_AGENT_MODEL),
    claudeSessionId: resumeId,
    state: 'starting',
    events: [],
    partials: new Map(),
    lastPartialId: null,
    usage: null,
    turnStartedAt: null,
    forks: [],
    child: null,
    ctx: { seq: 0, fallbackId: randomUUID, now: nowIso, lastSession: null },
    asks: new Map(),
    pendingControl: new Map(),
    writer: new TranscriptWriter(transcriptDir()),
    noise: [],
    sawJson: false,
    stopping: false,
    ready: Promise.resolve(),
  }
  agents.set(opts.agentId, held)

  let release!: () => void
  held.ready = new Promise<void>((resolve) => (release = resolve))
  try {
    if (resumeId) {
      try {
        await replayInto(held, resumeId)
      } catch (err) {
        console.warn('[visual-agent] transcript replay failed:', (err as Error)?.message ?? err)
      }
      held.writer.setSessionId(resumeId)
    }
    // An explicitly requested model wins over the one the transcript last ran.
    if (opts.model && isValidModel(opts.model)) held.model = opts.model
    prepWorktree(opts)
    spawnMain(held)
    if (opts.initialPrompt && opts.initialPrompt.trim()) {
      sendVisualAgentMessage(opts.agentId, opts.initialPrompt)
    }
  } finally {
    release()
  }
  return snapshotOf(held)
}

function prepWorktree(opts: VisualAgentStartOptions): void {
  try {
    writeClaudeHookSettings(opts.cwd, 'dark', opts.sessionId)
  } catch (err) {
    console.warn('[visual-agent] hook settings failed:', (err as Error)?.message ?? err)
  }
}

function requireAgent(agentId: string): LiveAgent {
  const held = agents.get(agentId)
  if (!held) throw new Error(`No visual agent ${agentId}`)
  return held
}

export function sendVisualAgentMessage(agentId: string, text: string): void {
  const held = requireAgent(agentId)
  if (typeof text !== 'string' || !text.trim()) return
  if (!isAlive(held.child)) {
    // Bring a finished/failed session back on the same conversation.
    prepWorktree(held.opts)
    spawnMain(held)
  }
  writeOut(held, userMessageFrame(text))
  held.turnStartedAt = nowIso()
  const prev = held.state
  held.state = 'running'
  emit(held, { t: 'state', state: 'running', turnStartedAt: held.turnStartedAt })
  reportStatus(held, prev, 'running')
}

export function interruptVisualAgent(agentId: string): void {
  const held = requireAgent(agentId)
  if (!isAlive(held.child)) return
  const requestId = nextRequestId('interrupt')
  const timer = setTimeout(() => {
    held.pendingControl.delete(requestId)
    interruptBySignal(held)
  }, INTERRUPT_FALLBACK_MS)
  held.pendingControl.set(requestId, { kind: 'interrupt', timer })
  try {
    writeOut(held, interruptFrame(requestId))
  } catch {
    clearTimeout(timer)
    held.pendingControl.delete(requestId)
    interruptBySignal(held)
  }
}

export function stopVisualAgent(agentId: string): void {
  const held = agents.get(agentId)
  if (!held) return
  for (const fork of held.forks) stopFork(held, fork)
  const child = held.child
  if (isAlive(child)) {
    held.stopping = true
    killChildTree(child)
  } else if (held.state !== 'failed') {
    setState(held, 'done')
  }
}

export function answerVisualAgent(
  agentId: string,
  requestId: string,
  decision: VisualAgentAskDecision,
  answers?: Record<string, string>
): void {
  const held = requireAgent(agentId)
  const request = held.asks.get(requestId)
  if (!request) throw new Error('That question is no longer waiting for an answer')
  if (decision !== 'allow' && decision !== 'always' && decision !== 'deny') {
    throw new Error(`Unknown decision ${String(decision)}`)
  }
  const frame =
    request.tool === QUESTION_TOOL && decision !== 'deny' && answers && Object.keys(answers).length > 0
      ? questionAnswerFrame(request, answers)
      : permissionResponseFrame(request, decision)
  writeOut(held, frame)
  held.asks.delete(requestId)
  if (held.asks.size === 0 && held.state === 'needs-input') setState(held, 'running')
}

export async function setVisualAgentModel(agentId: string, model: string): Promise<void> {
  const held = requireAgent(agentId)
  if (!isValidModel(model)) throw new Error(`Invalid model id: ${String(model)}`)
  if (model === held.model) return
  if (!isAlive(held.child)) {
    held.model = model
    emit(held, { t: 'session', claudeSessionId: held.claudeSessionId ?? '', model })
    return
  }
  const requestId = nextRequestId('model')
  const timer = setTimeout(() => {
    held.pendingControl.delete(requestId)
    void restartWithModel(held, model)
  }, SET_MODEL_FALLBACK_MS)
  held.pendingControl.set(requestId, { kind: 'set_model', model, timer })
  try {
    writeOut(held, setModelFrame(requestId, model))
  } catch {
    clearTimeout(timer)
    held.pendingControl.delete(requestId)
    await restartWithModel(held, model)
  }
}

export function forkVisualAgent(agentId: string, question: string): { forkId: string } {
  const held = requireAgent(agentId)
  const asked = typeof question === 'string' ? question.trim() : ''
  if (!asked) throw new Error('/btw needs a question after it')
  if (!held.claudeSessionId) {
    throw new Error('Nothing to fork yet — send a message first so the conversation exists')
  }
  const live = held.forks.filter((f) => f.info.state === 'running' || f.info.state === 'starting')
  if (live.length >= MAX_LIVE_FORKS) {
    throw new Error(`At most ${MAX_LIVE_FORKS} side questions can run at once`)
  }

  const forkId = randomUUID()
  const fork: LiveFork = {
    info: { id: forkId, question: asked, startedAt: nowIso(), afterSeq: held.ctx.seq, state: 'running', events: [] },
    child: null,
  }
  held.forks.push(fork)

  const child = spawnClaude(
    forkArgv({ parentSessionId: held.claudeSessionId, forkSessionId: forkId, model: held.model }),
    held.opts
  )
  fork.child = child
  const ctx: NormaliseContext = { seq: 0, fallbackId: randomUUID, now: nowIso, lastSession: null }
  const noise: string[] = []

  const pushForkEvent = (event: VisualAgentEvent): void => {
    fork.info.events.push(event)
    emit(held, { t: 'fork-event', forkId, event })
  }
  const settle = (state: VisualAgentRunState): void => {
    if (fork.info.state !== 'running' && fork.info.state !== 'starting') return
    fork.info.state = state
    emitForks(held)
  }

  const reader = lineReader(
    (parsed) => {
      for (const event of normalise(parsed, ctx)) {
        if (event.kind === 'session') continue
        pushForkEvent(event)
        if (event.kind === 'result') {
          settle(event.ok ? 'done' : 'failed')
          killChildTree(child)
        }
      }
    },
    (raw) => {
      if (noise.length < MAX_NOISE_LINES) noise.push(raw)
    }
  )
  child.stdout.on('data', (chunk: Buffer) => reader.push(chunk.toString('utf-8')))
  child.stderr.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf-8').split('\n')) {
      if (line.trim() && noise.length < MAX_NOISE_LINES) noise.push(line.trim())
    }
  })
  child.stdin.on?.('error', () => undefined)
  const fail = (message: string): void => {
    if (fork.info.state !== 'running' && fork.info.state !== 'starting') return
    pushForkEvent({ uuid: randomUUID(), seq: ctx.seq++, threadId: 'main', at: nowIso(), kind: 'error', message })
    settle('failed')
  }
  child.on('error', (err: Error) => fail(`Could not start the side question: ${err.message}`))
  child.on('exit', (code: number | null) => {
    reader.flush()
    fork.child = null
    if (code === 0) settle('done')
    else fail(`The side question ended early${noise.length ? `: ${noise.join('\n').slice(0, 2000)}` : '.'}`)
  })

  child.stdin.write(userMessageFrame(sideQuestionPreamble(asked)))
  emitForks(held)
  return { forkId }
}

function stopFork(held: LiveAgent, fork: LiveFork): void {
  if (fork.info.state === 'running' || fork.info.state === 'starting') {
    fork.info.state = 'done'
    emitForks(held)
  }
  if (fork.child && isAlive(fork.child)) killChildTree(fork.child)
}

export function stopVisualAgentFork(agentId: string, forkId: string): void {
  const held = requireAgent(agentId)
  const fork = held.forks.find((f) => f.info.id === forkId)
  if (fork) stopFork(held, fork)
}

export function getVisualAgentState(agentId: string): VisualAgentSnapshot | null {
  const held = agents.get(agentId)
  return held ? snapshotOf(held) : null
}

/** App quit: kill every visual-agent process and fork. */
export function killAllVisualAgents(): void {
  for (const held of agents.values()) {
    for (const fork of held.forks) {
      if (fork.child) killChildTree(fork.child)
    }
    if (held.child) {
      held.stopping = true
      killChildTree(held.child)
    }
  }
}

/** Test-only: forget every agent without killing anything. */
export function __resetVisualAgentsForTest(): void {
  agents.clear()
}

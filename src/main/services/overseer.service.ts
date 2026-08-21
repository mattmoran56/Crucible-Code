/**
 * Overseer — a master agent that watches every session in every project.
 *
 * Runs an Anthropic SDK agent loop in the main process with a small set of
 * tools over the app's own IPC surface: list the fleet, read a session, type
 * into one, start a new one. You talk to it in the Overseer panel; a heartbeat
 * wakes it periodically so it can come to you when something needs attention.
 *
 * Design notes:
 * - **Manual tool loop, not the SDK tool runner.** We need per-call control:
 *   emitting each tool call to the UI, enforcing the write gate, and capping
 *   iterations. The runner hides the turn boundary we want to act on.
 * - **No `thinking` or `effort` parameters.** Their support varies by model,
 *   and the model is user-switchable down to Haiku — passing a parameter the
 *   selected model rejects would turn a cost saving into a 400.
 * - **Tools go through `invokeHandler`**, the same registry the remote relay
 *   uses, rather than a second electron-store handle on the same file. One
 *   writer, no clobbering.
 *
 * See docs/OVERSEER.md.
 */
import Anthropic from '@anthropic-ai/sdk'
import Store from 'electron-store'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '../../shared/constants'
import type {
  ClaudeAccount,
  OverseerMessage,
  OverseerSessionSnapshot,
  OverseerSettings,
  OverseerState,
  Project,
  Session,
} from '../../shared/types'
import {
  canTypeInto,
  costForUsage,
  deriveSignals,
  detectPromptState,
  heartbeatWorthRunning,
  snapshotDigest,
  stripAnsi,
} from '../../shared/overseer'
import { invokeHandler } from '../ipc/handle'
import { getStorePath } from '../store-path'
import { getSessionStatus } from './session-status.service'
import {
  getTerminalBuffer,
  getTerminalLastOutputAt,
  injectPrompt,
  listTerminalsForSession,
} from './terminal.service'
import { createWorktree } from './worktree.service'

export const DEFAULT_SETTINGS: OverseerSettings = {
  // Haiku by default: the heartbeat runs unattended, so the cheapest capable
  // model is the right starting point. Switch it in Settings → Overseer.
  model: 'claude-haiku-4-5',
  heartbeatSeconds: 60,
  heartbeatEnabled: false,
  dailyCostCapUsd: 2,
  maxIterations: 12,
  allowWrites: false,
}

/** Keep the panel's scrollback bounded. */
const MAX_STORED_MESSAGES = 400
/** Turns of API history replayed per pass — the rest is dropped. */
const MAX_HISTORY_TURNS = 24
const MIN_HEARTBEAT_SECONDS = 30

interface OverseerStoreShape {
  settings: OverseerSettings
  messages: OverseerMessage[]
  spendTodayUsd: number
  spendDay: string
}

const store = new Store<OverseerStoreShape>({
  name: 'overseer',
  cwd: getStorePath(),
  defaults: {
    settings: DEFAULT_SETTINGS,
    messages: [],
    spendTodayUsd: 0,
    spendDay: '',
  },
})

let mainWindow: BrowserWindow | null = null
let running = false
let lastError: string | undefined
let lastHeartbeatAt: string | undefined
let lastDigest: string | undefined
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let unread = 0
let cancelRequested = false

/** In-memory API history. Rebuilt on restart — stored messages are for display. */
let history: Anthropic.MessageParam[] = []

export function setOverseerWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

// ── settings + state ────────────────────────────────────────────────────────

export function getSettings(): OverseerSettings {
  return { ...DEFAULT_SETTINGS, ...store.get('settings', DEFAULT_SETTINGS) }
}

export function setSettings(next: Partial<OverseerSettings>): OverseerSettings {
  const merged = { ...getSettings(), ...next }
  merged.heartbeatSeconds = Math.max(MIN_HEARTBEAT_SECONDS, Math.floor(merged.heartbeatSeconds))
  merged.maxIterations = Math.max(1, Math.min(40, Math.floor(merged.maxIterations)))
  store.set('settings', merged)
  restartHeartbeat()
  emitState()
  return merged
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function spendToday(): number {
  if (store.get('spendDay', '') !== today()) return 0
  return store.get('spendTodayUsd', 0)
}

function addSpend(usd: number): void {
  const day = today()
  const base = store.get('spendDay', '') === day ? store.get('spendTodayUsd', 0) : 0
  store.set('spendDay', day)
  store.set('spendTodayUsd', base + usd)
}

export function getState(): OverseerState {
  return {
    messages: store.get('messages', []),
    running,
    lastError,
    lastHeartbeatAt,
    spendTodayUsd: spendToday(),
    spendDay: today(),
    unread,
  }
}

function emitState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(IPC.OVERSEER_STATE_UPDATE, getState())
}

function appendMessage(message: Omit<OverseerMessage, 'id' | 'createdAt'>): OverseerMessage {
  const full: OverseerMessage = {
    ...message,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const messages = [...store.get('messages', []), full].slice(-MAX_STORED_MESSAGES)
  store.set('messages', messages)
  if (full.role === 'assistant') unread += 1
  emitState()
  return full
}

export function clearConversation(): void {
  store.set('messages', [])
  history = []
  unread = 0
  lastError = undefined
  emitState()
}

export function markRead(): void {
  unread = 0
  emitState()
}

// ── fleet snapshot (deterministic — no model involved) ──────────────────────

async function listProjects(): Promise<Project[]> {
  return (await invokeHandler(IPC.PROJECT_LIST, [])) as Project[]
}

async function listSessions(projectId: string): Promise<Session[]> {
  return (await invokeHandler(IPC.SESSION_LIST, [projectId])) as Session[]
}

/** The agent terminal for a session, if one is live. */
function agentTerminalFor(sessionId: string): string | undefined {
  const terminals = listTerminalsForSession(sessionId)
  const agent = terminals.find((t) => t.tabId === 'agent' || t.tabId.startsWith('agent:'))
  return agent?.terminalId
}

export async function buildSnapshot(projectId?: string): Promise<OverseerSessionSnapshot[]> {
  const projects = await listProjects()
  const wanted = projectId ? projects.filter((p) => p.id === projectId) : projects
  const out: OverseerSessionSnapshot[] = []

  for (const project of wanted) {
    const sessions = await listSessions(project.id)
    for (const session of sessions) {
      const terminalId = agentTerminalFor(session.id)
      const buffer = terminalId ? getTerminalBuffer(terminalId) : ''
      const promptState = terminalId ? detectPromptState(buffer) : undefined
      const lastOutputAt = terminalId ? getTerminalLastOutputAt(terminalId) : undefined
      const status = getSessionStatus(session.id)
      out.push({
        sessionId: session.id,
        name: session.name,
        projectId: project.id,
        projectName: project.name,
        branchName: session.branchName,
        status: status ?? 'idle',
        signals: deriveSignals({
          status,
          promptState,
          msSinceOutput: lastOutputAt ? Date.now() - lastOutputAt : undefined,
          hasAgentTerminal: !!terminalId,
        }),
        lastActivityAt: lastOutputAt ? new Date(lastOutputAt).toISOString() : session.lastActiveAt,
        hasAgentTerminal: !!terminalId,
      })
    }
  }
  return out
}

// ── tools ───────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_sessions',
    description:
      'List every session across all projects with its current status and signals. ' +
      'Status is one of running (agent is working), attention (agent asked for something), ' +
      'completed (agent finished its turn), idle (no recent activity). ' +
      'Signals are deterministic flags: waiting-permission, waiting-question, finished-turn, ' +
      'no-output-15m, no-agent-terminal. Start here — it is cheap and covers the whole fleet.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Optional — restrict to one project.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_session',
    description:
      'Read the tail of one session\'s agent terminal to see what it is actually doing or ' +
      'asking. Use this only for sessions that list_sessions flagged as interesting — it is ' +
      'much more expensive than the list.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        lines: {
          type: 'number',
          description: 'How many trailing lines to read. Default 60, max 200.',
        },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_message_to_session',
    description:
      'Type a message into a session\'s agent terminal and submit it — use this to answer a ' +
      "question the session asked, or to pass it extra context. Refuses when the session is " +
      'showing a tool-permission prompt: those are the user\'s to answer, never yours. ' +
      'Always read_session first so you are answering the question actually on screen.',
    input_schema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['sessionId', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_session',
    description:
      'Create a new session: a git worktree on a fresh branch, an agent terminal, and an ' +
      'opening prompt. Use when the user asks for new work to be picked up. Be conservative — ' +
      'each session is a real worktree on disk.',
    input_schema: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        name: {
          type: 'string',
          description: 'Short kebab-case session name, also used for the branch.',
        },
        prompt: { type: 'string', description: 'The opening brief for the new agent.' },
        baseBranch: { type: 'string', description: 'Optional base branch.' },
      },
      required: ['projectId', 'name', 'prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_to_user',
    description:
      'Send the user a message in the Overseer panel. This is how you speak up during a ' +
      'heartbeat. Only call it when there is something genuinely worth their attention — a ' +
      'session blocked on a question, a stall, work finished. Silence is the correct output ' +
      'for a quiet fleet.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What happened, in one or two sentences.' },
        needsAttention: {
          type: 'boolean',
          description: 'True if the user has to do something.',
        },
      },
      required: ['summary'],
      additionalProperties: false,
    },
  },
]

interface ToolOutcome {
  ok: boolean
  content: string
}

async function runTool(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case 'list_sessions': {
      const snapshot = await buildSnapshot(
        typeof input.projectId === 'string' ? input.projectId : undefined
      )
      if (snapshot.length === 0) return { ok: true, content: 'No sessions exist.' }
      return { ok: true, content: JSON.stringify(snapshot, null, 1) }
    }

    case 'read_session': {
      const sessionId = String(input.sessionId ?? '')
      const lines = Math.min(200, Math.max(5, Number(input.lines ?? 60)))
      const terminalId = agentTerminalFor(sessionId)
      if (!terminalId) {
        return { ok: false, content: `Session ${sessionId} has no live agent terminal.` }
      }
      const raw = getTerminalBuffer(terminalId)
      const tail = stripAnsi(raw)
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .slice(-lines)
        .join('\n')
      const promptState = detectPromptState(raw)
      return {
        ok: true,
        content: `promptState: ${promptState}\nstatus: ${getSessionStatus(sessionId) ?? 'idle'}\n\n${tail}`,
      }
    }

    case 'send_message_to_session': {
      const settings = getSettings()
      if (!settings.allowWrites) {
        return {
          ok: false,
          content:
            'Writes are disabled — the Overseer is in read-only mode. Report to the user instead.',
        }
      }
      const sessionId = String(input.sessionId ?? '')
      const message = String(input.message ?? '')
      if (!message.trim()) return { ok: false, content: 'Refusing to send an empty message.' }
      const terminalId = agentTerminalFor(sessionId)
      if (!terminalId) {
        return { ok: false, content: `Session ${sessionId} has no live agent terminal.` }
      }
      // The write gate. A tool-permission prompt is the user's to answer:
      // typing "1" here would be a permissions bypass by proxy. Fails closed —
      // anything we cannot classify is refused too.
      const promptState = detectPromptState(getTerminalBuffer(terminalId))
      if (!canTypeInto(promptState)) {
        return {
          ok: false,
          content:
            `Refused: session is showing "${promptState}", which is not safe to type into. ` +
            (promptState === 'permission-prompt'
              ? 'It is waiting on a tool-permission decision, which only the user may answer. ' +
                'Tell the user, do not answer it.'
              : 'Wait for it to return to an idle prompt, or tell the user.'),
        }
      }
      await injectPrompt(terminalId, `[Overseer] ${message}`)
      return { ok: true, content: `Sent to session ${sessionId}.` }
    }

    case 'start_session': {
      const settings = getSettings()
      if (!settings.allowWrites) {
        return {
          ok: false,
          content: 'Writes are disabled — the Overseer cannot start sessions in read-only mode.',
        }
      }
      return startSession({
        projectId: String(input.projectId ?? ''),
        name: String(input.name ?? ''),
        prompt: String(input.prompt ?? ''),
        baseBranch: typeof input.baseBranch === 'string' ? input.baseBranch : undefined,
      })
    }

    case 'report_to_user': {
      const summary = String(input.summary ?? '').trim()
      if (!summary) return { ok: false, content: 'Empty report ignored.' }
      appendMessage({
        role: 'assistant',
        content: summary,
        fromHeartbeat: true,
        needsAttention: input.needsAttention === true,
      })
      return { ok: true, content: 'Reported to the user.' }
    }

    default:
      return { ok: false, content: `Unknown tool: ${name}` }
  }
}

async function startSession(opts: {
  projectId: string
  name: string
  prompt: string
  baseBranch?: string
}): Promise<ToolOutcome> {
  const projects = await listProjects()
  const project = projects.find((p) => p.id === opts.projectId)
  if (!project) return { ok: false, content: `No project with id ${opts.projectId}.` }
  const name = opts.name.trim().replace(/[^a-zA-Z0-9._/-]/g, '-')
  if (!name) return { ok: false, content: 'A session name is required.' }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, content: 'No app window — cannot spawn a terminal.' }
  }

  const existing = await listSessions(project.id)
  if (existing.some((s) => s.name === name)) {
    return { ok: false, content: `A session named "${name}" already exists in ${project.name}.` }
  }

  const worktree = await createWorktree(project.repoPath, name, opts.baseBranch)
  const session: Session = {
    id: randomUUID(),
    name,
    branchName: worktree.branch,
    worktreePath: worktree.path,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    baseBranch: opts.baseBranch,
  }
  await invokeHandler(IPC.SESSION_SAVE, [project.id, [session, ...existing]])

  // Route this session's hooks back to us, exactly as the renderer does when
  // it creates one, so status tracking works for Overseer-started sessions.
  await invokeHandler('notification:register-session', [
    session.id,
    session.name,
    project.id,
    session.worktreePath,
    'session',
  ])

  const accounts = await getAccounts()
  const configDir = accounts.find((a) => a.id === project.claudeAccountId)?.configDir

  // Spawn through the IPC handler rather than calling spawnTerminal directly:
  // that path also writes the Claude hook settings and seeds the worktree's
  // permission allowlist. Bypassing it would give Overseer-started sessions a
  // bare worktree that prompts for everything.
  const terminalId = (await invokeHandler(IPC.TERMINAL_SPAWN, [
    session.id,
    session.worktreePath,
    'claude',
    'dark',
    configDir,
    project.repoPath,
    false,
    session.id,
    'agent',
  ])) as string

  // Let claude boot before pasting the brief in.
  setTimeout(() => {
    void injectPrompt(terminalId, opts.prompt)
  }, 4000)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.OVERSEER_SESSIONS_CHANGED, project.id)
  }

  return {
    ok: true,
    content: `Started session "${name}" on branch ${worktree.branch} in ${project.name} (id ${session.id}). The opening prompt is queued.`,
  }
}

async function getAccounts(): Promise<ClaudeAccount[]> {
  try {
    return (await invokeHandler(IPC.ACCOUNT_LIST, [])) as ClaudeAccount[]
  } catch {
    return []
  }
}

// ── the agent loop ──────────────────────────────────────────────────────────

function systemPrompt(): string {
  return [
    'You are the Overseer: an engineering manager for a fleet of Claude Code sessions.',
    'Each session is a developer working in its own git worktree on its own branch.',
    '',
    'Your job is to know what every session is doing, tell the user what needs them, and',
    'unblock what you safely can. Be extremely concise — the user is scanning, not reading.',
    'Prefer a small markdown table when reporting on several sessions.',
    '',
    'Rules:',
    '- Start with list_sessions. Only read_session for ones whose status or signals warrant it.',
    '- Never try to answer a tool-permission prompt. Those belong to the user. If a session is',
    '  blocked on one, say so and name the session.',
    '- When you send a message to a session, first read it so you are answering the real question.',
    '- Do not invent session state. If you did not read it, say you did not read it.',
    '- If nothing needs the user, say so in one line. Do not pad.',
  ].join('\n')
}

function client(settings: OverseerSettings): Anthropic {
  const apiKey = settings.apiKey?.trim() || process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('No API key set. Add one in Settings → Overseer.')
  return new Anthropic({ apiKey })
}

function trimHistory(): void {
  if (history.length <= MAX_HISTORY_TURNS) return
  // Drop from the front, but never leave a tool_result as the first message —
  // the API rejects a tool_result with no preceding tool_use.
  let start = history.length - MAX_HISTORY_TURNS
  while (start < history.length) {
    const msg = history[start]
    const isToolResult =
      Array.isArray(msg.content) && msg.content.some((b) => b.type === 'tool_result')
    if (!isToolResult) break
    start += 1
  }
  history = history.slice(start)
}

/**
 * Run one pass. `userText` is appended to the conversation as a user turn;
 * `display` controls whether it shows in the panel (heartbeat prompts don't).
 */
async function runPass(userText: string, opts: { display: boolean }): Promise<void> {
  if (running) {
    if (opts.display) {
      appendMessage({ role: 'system', content: 'Still working on the previous message.' })
    }
    return
  }

  const settings = getSettings()
  if (spendToday() >= settings.dailyCostCapUsd) {
    lastError = `Daily cost cap of $${settings.dailyCostCapUsd} reached — passes are paused.`
    emitState()
    return
  }

  let anthropic: Anthropic
  try {
    anthropic = client(settings)
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    emitState()
    return
  }

  running = true
  cancelRequested = false
  lastError = undefined
  if (opts.display) appendMessage({ role: 'user', content: userText })
  emitState()

  history.push({ role: 'user', content: userText })
  let passCost = 0

  try {
    for (let i = 0; i < settings.maxIterations; i++) {
      if (cancelRequested) {
        appendMessage({ role: 'system', content: 'Cancelled.' })
        break
      }
      trimHistory()

      const response = await anthropic.messages.create({
        model: settings.model,
        max_tokens: 4096,
        system: systemPrompt(),
        tools: TOOLS,
        messages: history,
      })

      passCost += costForUsage(
        settings.model,
        response.usage.input_tokens,
        response.usage.output_tokens
      )

      history.push({ role: 'assistant', content: response.content })

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join('\n\n')

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      )

      // `report_to_user` already posts its own message; don't double-post the
      // model's narration alongside it during a heartbeat.
      const reportsItself = toolUses.some((t) => t.name === 'report_to_user')
      if (text && (opts.display || !reportsItself)) {
        appendMessage({
          role: 'assistant',
          content: text,
          fromHeartbeat: !opts.display,
        })
      }

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break

      const results: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        // Every tool_use must come back with a tool_result, including when the
        // tool throws — otherwise the next turn sends an unanswered tool_use
        // and the API rejects the whole conversation.
        let outcome: ToolOutcome
        try {
          outcome = await runTool(
            toolUse.name,
            (toolUse.input ?? {}) as Record<string, unknown>
          )
        } catch (err) {
          outcome = {
            ok: false,
            content: `Tool threw: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
        appendMessage({
          role: 'tool',
          content: summariseToolCall(toolUse.name, toolUse.input as Record<string, unknown>),
          toolName: toolUse.name,
          toolOk: outcome.ok,
        })
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: outcome.content,
          is_error: !outcome.ok,
        })
      }
      history.push({ role: 'user', content: results })

      if (i === settings.maxIterations - 1) {
        appendMessage({
          role: 'system',
          content: `Stopped after ${settings.maxIterations} tool rounds.`,
        })
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    appendMessage({ role: 'system', content: `Error: ${lastError}` })
  } finally {
    addSpend(passCost)
    running = false
    emitState()
  }
}

/** A one-line description of a tool call for the panel's activity trail. */
function summariseToolCall(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'list_sessions':
      return input.projectId ? `Listed sessions in one project` : 'Listed all sessions'
    case 'read_session':
      return `Read session ${String(input.sessionId ?? '').slice(0, 8)}`
    case 'send_message_to_session':
      return `Messaged session ${String(input.sessionId ?? '').slice(0, 8)}`
    case 'start_session':
      return `Started session "${String(input.name ?? '')}"`
    case 'report_to_user':
      return 'Reported'
    default:
      return name
  }
}

export async function sendUserMessage(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  await runPass(trimmed, { display: true })
}

export function cancel(): void {
  if (running) cancelRequested = true
}

// ── heartbeat ───────────────────────────────────────────────────────────────

const HEARTBEAT_PROMPT = [
  'Heartbeat check. Look at the fleet and decide whether anything needs the user.',
  'If something does — a session waiting on a question, blocked on a permission prompt,',
  'stalled, or newly finished — call report_to_user with a one or two sentence summary.',
  'If nothing does, reply with the single word: quiet. Do not call report_to_user.',
].join(' ')

/**
 * One heartbeat tick. Cheap by design: it builds the snapshot deterministically
 * and only spends a model call when the fleet actually changed since the last
 * tick. A quiet fleet costs nothing, which is what makes a 60s interval sane.
 */
export async function heartbeatTick(force = false): Promise<void> {
  if (running) return
  const settings = getSettings()
  if (!force && !settings.heartbeatEnabled) return

  const snapshot = await buildSnapshot()
  lastHeartbeatAt = new Date().toISOString()

  if (!force && !heartbeatWorthRunning(snapshot, lastDigest)) {
    emitState()
    return
  }
  lastDigest = snapshotDigest(snapshot)
  await runPass(HEARTBEAT_PROMPT, { display: false })
}

function restartHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
  const settings = getSettings()
  if (!settings.heartbeatEnabled) return
  heartbeatTimer = setInterval(() => {
    void heartbeatTick().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err)
      emitState()
    })
  }, settings.heartbeatSeconds * 1000)
}

export function installOverseer(window: BrowserWindow): void {
  setOverseerWindow(window)
  // Seed the digest so the first tick after launch doesn't report the entire
  // existing fleet as "new".
  void buildSnapshot()
    .then((s) => {
      lastDigest = snapshotDigest(s)
    })
    .catch(() => {
      /* nothing to seed — first tick will report */
    })
  restartHeartbeat()
}

export function stopOverseer(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

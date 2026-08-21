import type { HookType, SessionStatus, OverseerSessionSnapshot } from './types'

/**
 * Pure helpers shared by the main-process Overseer services and their tests.
 * Nothing here touches Electron, the filesystem, or the network — which is
 * what makes the interesting logic (status transitions, the write gate,
 * change detection) testable without a running app.
 */

/**
 * Advance a single tab's status for one hook event. Mirrors the renderer's
 * `notificationStore.handleHookEvent` semantics so the two views of a session
 * agree — with one deliberate difference: the renderer defers `attention →
 * completed` until the *user* clears the badge, because that transition exists
 * to preserve a visual cue. The Overseer has no badge to preserve, so a stop
 * after attention simply completes.
 *
 * Returns `null` when the event should not change the stored status.
 */
export function nextSessionStatus(
  current: SessionStatus | undefined,
  hookType: HookType
): SessionStatus | null {
  switch (hookType) {
    case 'prompt':
      return current === 'running' ? null : 'running'
    case 'notification':
      return 'attention'
    case 'stop':
      return 'completed'
    default:
      return null
  }
}

const STATUS_RANK: Record<SessionStatus, number> = {
  attention: 3,
  completed: 2,
  running: 1,
}

/** Worst-of rollup across a session's tabs: attention > completed > running. */
export function rollupStatus(statuses: Iterable<SessionStatus>): SessionStatus | undefined {
  let best: SessionStatus | undefined
  for (const s of statuses) {
    if (!best || STATUS_RANK[s] > STATUS_RANK[best]) best = s
  }
  return best
}

/**
 * CSI / OSC escape sequences plus the stray control characters xterm leaves in
 * a scrollback buffer. Written with explicit unicode escapes so the source
 * stays free of literal control bytes.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*(?:\u0007|\u001b\\)|\u001b[()][A-B0-2]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/** Strip ANSI escapes and control characters from a terminal buffer. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, '')
}

export type PromptState =
  | 'permission-prompt'
  | 'question'
  | 'input-idle'
  | 'working'
  | 'unknown'

/**
 * Classify what a Claude Code TUI is showing, from the tail of its terminal.
 *
 * This is the safety gate: the Overseer must never type at a *permission*
 * prompt, because answering "1. Yes" on the user's behalf is a permissions
 * bypass wearing a manager's hat (see CLAUDE.md). It fails closed — anything
 * it cannot confidently classify comes back `unknown`, and callers must treat
 * `unknown` as unsafe to type into.
 */
export function detectPromptState(screenTail: string): PromptState {
  const text = stripAnsi(screenTail)
  // Only the last chunk matters — earlier prompts have already been answered.
  const tail = text.slice(-2000)
  const recent = tail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-25)
    .join('\n')

  // Claude Code renders permission requests as a numbered allow/deny menu.
  const numberedOption = /(^|\n)\s*(?:[>❯]\s*)?[123]\.\s+\S/
  const permissionPhrases =
    /(do you want to proceed|would you like to proceed|wants? to (?:run|edit|create|read|write)|requesting permission|allow this|yes, and don'?t ask again|no, and tell claude what to do differently)/i
  if (permissionPhrases.test(recent)) return 'permission-prompt'

  // A bare numbered menu with no permission phrasing is still a menu — typing
  // free text into it does nothing useful, so treat it as unsafe.
  if (/(^|\n)\s*[>❯]\s*[123]\.\s/.test(recent) && numberedOption.test(recent)) {
    return 'unknown'
  }

  // Spinner / working indicators, and the interrupt hint that accompanies them.
  if (/esc to interrupt|thinking…|✳|✶|✻|✽/i.test(recent)) return 'working'

  // The idle composer box. Claude Code draws a prompt line with a caret.
  if (/(^|\n)\s*[|│]?\s*[>❯]\s*$/.test(tail) || /Try "/.test(recent)) return 'input-idle'

  // An assistant turn that ends in a question, with nothing else going on.
  if (/\?\s*$/.test(recent)) return 'question'

  return 'unknown'
}

/** Prompt states the Overseer is allowed to type into. */
export function canTypeInto(state: PromptState): boolean {
  return state === 'input-idle' || state === 'question'
}

export interface SignalInput {
  status?: SessionStatus
  promptState?: PromptState
  /** ms since the terminal last produced output. */
  msSinceOutput?: number
  hasAgentTerminal: boolean
}

const IDLE_MS = 15 * 60 * 1000

/**
 * Cheap deterministic flags computed before the model sees anything. They keep
 * the snapshot small and stop the Overseer having to infer state from raw
 * bytes — and they're what makes a heartbeat useful without a drill-down.
 */
export function deriveSignals(input: SignalInput): string[] {
  const signals: string[] = []
  if (!input.hasAgentTerminal) {
    signals.push('no-agent-terminal')
    return signals
  }
  if (input.promptState === 'permission-prompt') signals.push('waiting-permission')
  if (input.status === 'attention' && input.promptState !== 'permission-prompt') {
    signals.push('waiting-question')
  }
  if (input.status === 'completed') signals.push('finished-turn')
  if (
    input.status === 'running' &&
    typeof input.msSinceOutput === 'number' &&
    input.msSinceOutput > IDLE_MS
  ) {
    signals.push('no-output-15m')
  }
  return signals
}

/**
 * A stable digest of the fleet. The heartbeat compares this between ticks and
 * skips the API call entirely when nothing moved — which is what keeps a quiet
 * fleet free rather than one model call every minute forever.
 */
export function snapshotDigest(snapshots: OverseerSessionSnapshot[]): string {
  return snapshots
    .map((s) => `${s.sessionId}:${s.status}:${s.signals.join(',')}`)
    .sort()
    .join('|')
}

/**
 * True when a tick has something worth spending a model call on: the fleet
 * changed shape since the last tick. An unchanged fleet — even one with a
 * session still sitting in `attention` — is not re-reported, because the tick
 * that first saw it already did.
 */
export function heartbeatWorthRunning(
  snapshots: OverseerSessionSnapshot[],
  previousDigest: string | undefined
): boolean {
  return snapshotDigest(snapshots) !== previousDigest
}

/** Cost in USD for a completed turn, from the model's own usage numbers. */
export function costForUsage(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  // Per million tokens. Unknown models fall back to Sonnet-tier pricing so an
  // unrecognised id over-reports rather than silently reading as free.
  const table: Record<string, [number, number]> = {
    'claude-haiku-4-5': [1, 5],
    'claude-sonnet-5': [3, 15],
    'claude-opus-5': [5, 25],
  }
  const [inRate, outRate] = table[model] ?? [3, 15]
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
}

import { IPC } from '../../shared/constants'
import { eventBus } from './event-bus'
import { getTerminalBuffer, writeTerminal } from './terminal.service'

// Shared "drive a live worker PTY and wait for it to respond" plumbing. Used by
// the foundry FSM (ready-for-review prompt, CI fix loop) and the PR-stack
// upward-propagation conflict resolver. Extracted from foundry.service so both
// callers share one battle-tested implementation.

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'
const READY_TIMEOUT_MS = 15 * 60_000
const BRACKETED_PASTE_DELAY_MS = 250
/** How much the PTY buffer must grow for us to count this stop as "real". */
const MIN_RESPONSE_GROWTH_BYTES = 200

/**
 * Type the prompt into the PTY (bracketed-paste mode so claude's TUI treats
 * the whole multi-line block as one paste rather than a sequence of
 * keystrokes), wait a beat for it to render, then send the submit CR.
 * Then wait for a stop hook event AND require the PTY's rolling buffer to
 * have grown by at least MIN_RESPONSE_GROWTH_BYTES — that's how we
 * distinguish a real worker response from a stale stop event (the previous
 * turn's stop hook landing late, the auto-restart synthetic stop, etc.).
 *
 * Returns true on a verified response, false on timeout/stale.
 */
export async function injectAndAwaitResponse(
  terminalId: string,
  contextId: string,
  prompt: string
): Promise<boolean> {
  const bufferBefore = getTerminalBuffer(terminalId).length
  const normalised = prompt.replace(/\r\n/g, '\n')
  writeTerminal(terminalId, `${BRACKETED_PASTE_START}${normalised}${BRACKETED_PASTE_END}`)
  await new Promise((r) => setTimeout(r, BRACKETED_PASTE_DELAY_MS))
  writeTerminal(terminalId, '\r')

  // Keep listening for stop events until either we see a "real" one (buffer
  // grew meaningfully → claude actually produced output) or we run out of
  // time. Stale events are ignored, not consumed.
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const ok = await waitForSessionStop(contextId, remaining)
    if (!ok) return false
    const growth = getTerminalBuffer(terminalId).length - bufferBefore
    if (growth >= MIN_RESPONSE_GROWTH_BYTES) return true
    // Stale-looking stop — log and keep waiting.
    console.log(
      `[worker-inject] ignoring stale stop on ${contextId.slice(0, 8)}… (PTY buffer grew only ${growth} bytes)`
    )
  }
  return false
}

/**
 * Resolves true the next time the given contextId emits a 'stop' hook event,
 * or false on timeout. Used to know when a worker finished an injected prompt.
 */
export function waitForSessionStop(contextId: string, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const listener = (cid: string, _tabId: string, hookType: string): void => {
      if (settled) return
      if (cid !== contextId || hookType !== 'stop') return
      settled = true
      eventBus.off(IPC.NOTIFICATION_SESSION_STATUS, listener)
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      eventBus.off(IPC.NOTIFICATION_SESSION_STATUS, listener)
      resolve(false)
    }, timeoutMs)
    eventBus.on(IPC.NOTIFICATION_SESSION_STATUS, listener)
  })
}

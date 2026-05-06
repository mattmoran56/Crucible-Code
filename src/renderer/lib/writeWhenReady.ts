// Inject a command into a freshly-spawned PTY once it's ready for input.
//
// Strategy:
//   - Subscribe to terminal data and watch for prompt-like markers.
//   - If we see an MCP / permission confirmation, send Enter to take the
//     default (top-most) option. Claude renders these before the main input
//     prompt for new sessions that touch tools — without auto-confirming we
//     never reach the input prompt and the queued command never runs. We
//     allow up to 3 such auto-confirmations to handle multi-step flows.
//   - When we see a main input prompt indicator (`>` or `$`) or hit the
//     fallback timeout, send the queued command followed by `\r`.
//
// Multi-call safe per-terminal: redundant invocations on the same terminalId
// become no-ops, so a fire-handler path and a TerminalPanel useEffect path
// can both call writeWhenReady without double-firing.

interface WriteWhenReadyOptions {
  /** Timeout before the unconditional fallback fires. Default 6000 ms. */
  timeoutMs?: number
  /** Maximum number of auto-Enters for MCP/permission prompts. Default 3. */
  maxAutoConfirms?: number
  /** When true, log progress to the console — useful for diagnosing an inject that didn't happen. */
  debug?: boolean
}

// Per-terminal handle tracker. Once writeWhenReady is armed for a given
// terminal, repeat callers become no-ops.
const handledTerminals = new Set<string>()

// Markers that indicate an MCP / permission confirmation prompt where the
// safe default action is to press Enter (taking the top option). Conservative
// so we don't accidentally Enter on regular claude output.
const MCP_CONFIRM_MARKERS: RegExp[] = [
  /\bAllow [^?\n]{0,80}\?/i,        // "Allow Notion to ...?"
  /\bApprove\b[^?\n]{0,80}\?/i,     // "Approve MCP tool ...?"
  /\bTrust\b[^?\n]{0,80}\?/i,       // "Trust this MCP server?"
  /\bMCP\b[^?\n]{0,80}\?/i,         // generic "...MCP...?"
  /❯\s+(Yes|Allow|Approve|Trust)/i, // selection arrow on the affirmative option
]

function looksLikeMcpPrompt(data: string): boolean {
  return MCP_CONFIRM_MARKERS.some((re) => re.test(data))
}

function looksLikeMainInputPrompt(data: string): boolean {
  return data.includes('>') || data.includes('$')
}

export function writeWhenReady(
  terminalId: string,
  command: string,
  opts: WriteWhenReadyOptions = {}
): void {
  const timeoutMs = opts.timeoutMs ?? 6000
  const maxAutoConfirms = opts.maxAutoConfirms ?? 3
  const debug = opts.debug ?? true

  if (handledTerminals.has(terminalId)) {
    if (debug) console.log(`[writeWhenReady] skip duplicate call for ${terminalId}`)
    return
  }
  handledTerminals.add(terminalId)

  if (debug) {
    console.log(
      `[writeWhenReady] arming for ${terminalId}, timeout=${timeoutMs}ms, command=${JSON.stringify(command)}`
    )
  }

  let sent = false
  let autoConfirmsUsed = 0
  // Once we send an Enter for an MCP prompt, throttle further confirms to
  // avoid spamming if claude streams the same screen multiple times.
  let lastConfirmAt = 0
  const CONFIRM_THROTTLE_MS = 600

  const performWrite = (reason: string) => {
    if (sent) return
    sent = true
    unsub()
    if (debug) console.log(`[writeWhenReady] writing command to ${terminalId} (${reason})`)
    window.api.terminal.write(terminalId, command + '\r')
  }

  const sendEnter = (reason: string) => {
    if (sent) return
    if (Date.now() - lastConfirmAt < CONFIRM_THROTTLE_MS) return
    if (autoConfirmsUsed >= maxAutoConfirms) return
    autoConfirmsUsed += 1
    lastConfirmAt = Date.now()
    if (debug) {
      console.log(
        `[writeWhenReady] auto-Enter ${autoConfirmsUsed}/${maxAutoConfirms} for ${terminalId} (${reason})`
      )
    }
    window.api.terminal.write(terminalId, '\r')
  }

  const unsub = window.api.terminal.onData((tid: string, data: string) => {
    if (tid !== terminalId || sent) return

    if (looksLikeMcpPrompt(data)) {
      // Slight delay so claude's selection state is fully painted before we
      // accept it.
      setTimeout(() => sendEnter('mcp-prompt'), 150)
      return
    }

    if (looksLikeMainInputPrompt(data)) {
      // Grace period so claude has time to bind raw-mode stdin.
      setTimeout(() => performWrite('prompt-detected'), 150)
    }
  })

  setTimeout(() => performWrite('timeout-fallback'), timeoutMs)
}

/** Test-only: clear the per-page write-once registry. */
export function __resetWriteWhenReadyForTests(): void {
  handledTerminals.clear()
}

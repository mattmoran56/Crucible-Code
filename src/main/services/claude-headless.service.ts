/**
 * Shared headless claude subprocess runner. Used by review-loop.service,
 * review-loop-lite.service, and foundry-foreman.service.
 *
 * Runs `claude --print --output-format stream-json --verbose
 * --dangerously-skip-permissions` (plus optional --resume), pipes the prompt
 * on stdin, parses NDJSON into human-readable transcript lines, captures
 * session_id + total cost, kills the process tree on timeout/cancel.
 */
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'

export const DEFAULT_PHASE_TIMEOUT_MS = 30 * 60 * 1000

export interface HeadlessClaudeOptions {
  cwd: string
  prompt: string
  resumeId?: string
  /** Extra environment vars merged on top of process.env. */
  env?: Record<string, string>
  timeoutMs?: number
  /** Called for each transcript line as it arrives. */
  onTranscript?: (line: string) => void
  /** Hook the spawned child so callers can cancel mid-run. */
  onChild?: (child: ChildProcessWithoutNullStreams) => void
  /** Extra args appended after the standard flags (e.g. ['--model', 'opus']). */
  extraArgs?: string[]
}

export interface HeadlessClaudeResult {
  ok: boolean
  costUsd: number
  sessionId?: string
  error?: string
  transcript: string[]
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export function killChildTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals = 'SIGTERM'
): void {
  if (!child || child.killed || child.pid == null) return
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal)
    } else {
      child.kill(signal)
    }
  } catch {
    // Already exited.
  }
}

export function summarizeToolInput(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Record<string, unknown>
  for (const key of ['file_path', 'path', 'command', 'pattern', 'description', 'subagent_type']) {
    const val = obj[key]
    if (typeof val === 'string' && val.trim()) return truncate(val.trim(), 120)
  }
  try {
    return truncate(JSON.stringify(obj), 120)
  } catch {
    return ''
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

export function runHeadlessClaude(opts: HeadlessClaudeOptions): Promise<HeadlessClaudeResult> {
  return new Promise((resolve) => {
    const MAX_BUF_BYTES = 5 * 1024 * 1024
    const timeoutMs = opts.timeoutMs ?? DEFAULT_PHASE_TIMEOUT_MS
    const transcript: string[] = []
    let stderrBuf = ''
    let lineBuf = ''
    let costUsd = 0
    let sessionId: string | undefined
    let bufferOverflow = false

    const pushTranscript = (line: string): void => {
      const trimmed = line.replace(/\s+$/g, '')
      if (!trimmed) return
      const stamped = `[${new Date().toISOString().slice(11, 19)}] ${trimmed}`
      transcript.push(stamped)
      opts.onTranscript?.(stamped)
    }

    const handleEvent = (evt: any): void => {
      if (!evt || typeof evt !== 'object') return
      switch (evt.type) {
        case 'system':
          if (evt.subtype === 'init') {
            if (typeof evt.session_id === 'string') sessionId = evt.session_id
            pushTranscript(
              `▶ session ${evt.session_id ?? ''} started${evt.model ? ` (${evt.model})` : ''}`
            )
          }
          break
        case 'assistant': {
          const content = evt.message?.content
          if (!Array.isArray(content)) return
          for (const block of content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              for (const line of block.text.split('\n')) pushTranscript(line)
            } else if (block.type === 'tool_use') {
              const name = block.name ?? 'tool'
              const summary = summarizeToolInput(block.input)
              pushTranscript(`🔧 ${name}${summary ? ` ${summary}` : ''}`)
            }
          }
          break
        }
        case 'user': {
          const content = evt.message?.content
          if (!Array.isArray(content)) return
          for (const block of content) {
            if (block.type === 'tool_result' && block.is_error) {
              const text =
                typeof block.content === 'string'
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content.map((c: any) => c?.text ?? '').join(' ')
                    : ''
              pushTranscript(`⚠ tool error: ${text.slice(0, 300)}`)
            }
          }
          break
        }
        case 'result':
          if (typeof evt.total_cost_usd === 'number') costUsd = evt.total_cost_usd
          else if (typeof evt.cost === 'number') costUsd = evt.cost
          break
      }
    }

    const consumeStdout = (chunk: Buffer): void => {
      if (bufferOverflow) return
      lineBuf += chunk.toString('utf-8')
      let nlIdx: number
      while ((nlIdx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, nlIdx).trim()
        lineBuf = lineBuf.slice(nlIdx + 1)
        if (!line) continue
        try {
          handleEvent(JSON.parse(line))
        } catch {
          pushTranscript(line)
        }
      }
      if (lineBuf.length > MAX_BUF_BYTES) {
        bufferOverflow = true
        lineBuf = ''
        pushTranscript(`✖ stdout exceeded ${MAX_BUF_BYTES} bytes without a newline — terminating`)
        killChildTree(child)
      }
    }

    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ]
    if (opts.resumeId) args.push('--resume', opts.resumeId)
    if (opts.extraArgs && opts.extraArgs.length > 0) args.push(...opts.extraArgs)

    const env: NodeJS.ProcessEnv = { ...process.env, ...(opts.env ?? {}) }

    const child = spawn('claude', args, {
      cwd: opts.cwd,
      env,
      detached: process.platform !== 'win32',
    })
    opts.onChild?.(child)

    let timedOut = false
    const phaseTimer = setTimeout(() => {
      timedOut = true
      pushTranscript(`✖ phase timed out after ${Math.round(timeoutMs / 60000)}m — terminating`)
      killChildTree(child)
    }, timeoutMs)

    child.stdout.on('data', consumeStdout)
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      if (stderrBuf.length < MAX_BUF_BYTES) {
        stderrBuf = (stderrBuf + text).slice(-MAX_BUF_BYTES)
      }
      for (const line of text.split('\n')) {
        if (line.trim()) pushTranscript(`stderr: ${line.trim()}`)
      }
    })
    child.on('error', (err) => {
      pushTranscript(`✖ ${err.message}`)
      clearTimeout(phaseTimer)
      resolve({
        ok: false,
        costUsd,
        sessionId,
        error: err.message,
        transcript,
        exitCode: null,
        signal: null,
      })
    })
    child.on('exit', (code, signal) => {
      clearTimeout(phaseTimer)
      if (lineBuf.trim()) {
        try {
          handleEvent(JSON.parse(lineBuf.trim()))
        } catch {
          pushTranscript(lineBuf.trim())
        }
        lineBuf = ''
      }
      if (signal === 'SIGTERM') {
        const error = timedOut
          ? `phase timed out after ${Math.round(timeoutMs / 60000)}m`
          : bufferOverflow
            ? 'stdout buffer exceeded'
            : 'cancelled'
        resolve({ ok: false, costUsd, sessionId, error, transcript, exitCode: code, signal })
        return
      }
      if (code !== 0) {
        resolve({
          ok: false,
          costUsd,
          sessionId,
          error: stderrBuf.trim() || `claude exited with code ${code}`,
          transcript,
          exitCode: code,
          signal,
        })
        return
      }
      resolve({ ok: true, costUsd, sessionId, transcript, exitCode: code, signal })
    })

    child.stdin.write(opts.prompt)
    child.stdin.end()
  })
}

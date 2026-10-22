/**
 * argv and stdin frame builders for a visual agent's `claude -p` process.
 * Pure — no spawning here. Ported from meet-jef's `launch.ts`,
 * `permissions.ts`, `asks.ts` and `btw.ts`, adapted to a local child process.
 *
 * PERMISSIONS: never `--dangerously-skip-permissions` and never any
 * `--permission-mode`. `AUTO_PERMISSION_MODE_ARGS` is empty so the CLI inherits
 * the user's configured default (auto) — see CLAUDE.md.
 */
import { AUTO_PERMISSION_MODE_ARGS } from '../terminal.service'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../../../shared/visual-agent'
import type { VisualAgentAskDecision } from '../../../shared/visual-agent'
import type { PermissionRequest } from './normalise'

export const MODEL_PATTERN = /^claude-[a-z0-9-]+(\[1m\])?$/

export const isValidModel = (model: unknown): model is string =>
  typeof model === 'string' && MODEL_PATTERN.test(model)

export const resolveModel = (model: unknown): string =>
  isValidModel(model) ? model : DEFAULT_VISUAL_AGENT_MODEL

/** The flags every visual-agent process (main or fork) speaks. */
const STREAM_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--input-format',
  'stream-json',
  '--verbose',
]

export interface AgentArgvOptions {
  model: string
  resume?: string | null
}

/**
 * The long-lived main process.
 *
 * `--permission-prompt-tool stdio` routes permission questions over this same
 * stream as `control_request` `can_use_tool` (hidden flag in the CLI, but
 * accepted — verified against 2.1.306). It also enables AskUserQuestion.
 */
export const agentArgv = (opts: AgentArgvOptions): string[] => {
  const argv = [
    ...STREAM_ARGS,
    '--include-partial-messages',
    '--forward-subagent-text',
    '--permission-prompt-tool',
    'stdio',
    ...AUTO_PERMISSION_MODE_ARGS,
    '--model',
    resolveModel(opts.model),
  ]
  if (opts.resume) argv.push('--resume', opts.resume)
  return argv
}

export interface ForkArgvOptions {
  parentSessionId: string
  forkSessionId: string
  model: string
}

/**
 * A `/btw` side question: fork the parent's conversation into a session with
 * no tools and no MCP servers, ask once, and stop. No permission prompt tool —
 * a fork must have no route to doing anything.
 */
export const forkArgv = (opts: ForkArgvOptions): string[] => [
  ...STREAM_ARGS,
  '--resume',
  opts.parentSessionId,
  '--fork-session',
  '--session-id',
  opts.forkSessionId,
  '--tools',
  '',
  '--strict-mcp-config',
  ...AUTO_PERMISSION_MODE_ARGS,
  '--model',
  resolveModel(opts.model),
]

/* --- stdin frames --------------------------------------------------------- */

const line = (value: unknown): string => `${JSON.stringify(value)}\n`

/** One user message in the shape `--input-format stream-json` expects. */
export const userMessageFrame = (text: string): string =>
  line({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
  })

export const controlRequestFrame = (requestId: string, request: Record<string, unknown>): string =>
  line({ type: 'control_request', request_id: requestId, request })

export const interruptFrame = (requestId: string): string =>
  controlRequestFrame(requestId, { subtype: 'interrupt' })

/**
 * The SDK handshake. Answered before any message (with --input-format
 * stream-json the CLI says nothing else until then) with, among others, the
 * full slash-command list: repo and user commands, skills, plugins, built-ins.
 */
export const initializeFrame = (requestId: string): string =>
  controlRequestFrame(requestId, { subtype: 'initialize' })

export const setModelFrame =(requestId: string, model: string): string =>
  controlRequestFrame(requestId, { subtype: 'set_model', model })

export const DENY_MESSAGE = 'Denied from CodeCrucible.'

/**
 * The answer to a `can_use_tool` request.
 *
 * `destination: "session"` on an "always" is deliberate: Claude Code suggests
 * `localSettings`, which would write `.claude/settings.local.json` into the
 * worktree. Rewriting it keeps the grant to this run only.
 */
export const permissionResponseFrame = (
  request: PermissionRequest,
  decision: VisualAgentAskDecision,
  denial = DENY_MESSAGE
): string => {
  const response =
    decision === 'deny'
      ? { behavior: 'deny', message: denial, toolUseID: request.toolUseId ?? undefined }
      : {
          behavior: 'allow',
          updatedInput: request.input,
          ...(decision === 'always' && !request.noStandingRule && request.grants.length > 0
            ? {
                updatedPermissions: [
                  { type: 'addRules', rules: request.grants, behavior: 'allow', destination: 'session' },
                ],
              }
            : {}),
        }
  return line({
    type: 'control_response',
    response: { subtype: 'success', request_id: request.id, response },
  })
}

export const QUESTION_TOOL = 'AskUserQuestion'

/**
 * The answer to an `AskUserQuestion` call: an allow whose `updatedInput`
 * carries `answers` keyed by question text.
 */
export const questionAnswerFrame = (
  request: PermissionRequest,
  answers: Record<string, string>
): string => {
  const input =
    request.input && typeof request.input === 'object' && !Array.isArray(request.input)
      ? (request.input as Record<string, unknown>)
      : {}
  return line({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: request.id,
      response: { behavior: 'allow', updatedInput: { ...input, answers } },
    },
  })
}

/** The preamble that tells a forked session it is a side question. */
export const sideQuestionPreamble = (question: string): string =>
  [
    '[crucible] This is a side question, asked in a fork of the conversation above.',
    'You have no tools: answer from this conversation alone, and where you would need to look something up, say what you would check rather than trying.',
    'Answer and stop — do not carry on with what the conversation was doing. Nothing you say goes back into it.',
    '',
    question,
  ].join('\n')

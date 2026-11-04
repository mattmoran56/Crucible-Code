/**
 * Session dispatch: lets an agent running inside Crucible start other Crucible
 * sessions (and message them) through the app's built-in `crucible` MCP server.
 *
 * The main process serves the MCP endpoint and forwards each tool call to the
 * renderer, which creates sessions through the same paths the UI uses. This
 * module holds what both sides share: the request/response shapes, the tool
 * schemas and the server instructions every agent is given.
 */

export type DispatchLocation = 'local' | 'cloud'
export type DispatchMode = 'single-branch' | 'orchestrator'

/** `dispatch_session` arguments, validated. */
export interface DispatchSessionArgs {
  task: string
  name?: string
  location: DispatchLocation
  /** False: a repo-root agent in the main checkout (no worktree, no branch). Local only. */
  worktree: boolean
  baseBranch?: string
  branchName?: string
  mode: DispatchMode
}

/** `send_to_session` arguments, validated. */
export interface SendToSessionArgs {
  sessionId: string
  message: string
}

/** One call forwarded from the MCP server to the renderer. */
export type SessionDispatchRequest =
  | { id: string; contextId: string; tool: 'dispatch_session'; args: DispatchSessionArgs }
  | { id: string; contextId: string; tool: 'list_sessions'; args: Record<string, never> }
  | { id: string; contextId: string; tool: 'send_to_session'; args: SendToSessionArgs }

/** The renderer's answer: text for the agent, or an error message. */
export type SessionDispatchResponse = { ok: true; text: string } | { ok: false; error: string }

/** The session that asked, stored on what it dispatched. */
export interface DispatchedBy {
  /** App session id, absent when an agent in the Code workspace dispatched it. */
  sessionId?: string
  name: string
}

export const DISPATCH_TOOL_NAMES = ['dispatch_session', 'list_sessions', 'send_to_session'] as const
export type DispatchToolName = (typeof DISPATCH_TOOL_NAMES)[number]

/** Name of the MCP server as agents see it (`mcp__crucible__dispatch_session`). */
export const DISPATCH_MCP_SERVER_NAME = 'crucible'

/** Put in the system prompt of every agent that has the server. */
export const DISPATCH_MCP_INSTRUCTIONS = [
  'You are running inside Crucible Code, a desktop app where the user works with many Claude sessions side by side.',
  'These tools let you hand work off to new Crucible sessions that the user can open and talk to from the sidebar.',
  'When the user asks you to start, spin up, kick off, dispatch or hand off another session or agent (for example "start another session to do X"), call dispatch_session with a self-contained task: the new session sees only that text, not this conversation.',
  'Default to one worktree session per task: its own git worktree and branch, so its own pull request, and Crucible deletes it automatically once that pull request merges. Dispatch several sessions for several independent tasks rather than bundling them.',
  'Sessions run locally by default. Pass location "cloud" only when the user asks for the cloud (Claude Code on the web); it needs a worktree. Pass worktree false only for a conversation in the main checkout with no branch of its own.',
  'Every dispatched session gets the same MCP servers, settings and Claude account as a session the user starts by hand, including these tools.',
  'Use list_sessions to see what exists, and send_to_session to send a follow-up message to a session. After dispatching, tell the user the name of each session you started.',
].join(' ')

type JsonSchema = Record<string, unknown>

export interface DispatchToolDefinition {
  name: DispatchToolName
  description: string
  inputSchema: JsonSchema
}

export const DISPATCH_TOOLS: DispatchToolDefinition[] = [
  {
    name: 'dispatch_session',
    description:
      'Start a new Crucible session that works on a task in the background. It appears in the sidebar of the same project, where the user can open it and talk to it. By default it gets its own git worktree and branch (one session, one branch, one PR; deleted automatically after its PR merges) and runs locally. Returns the new session\'s id, name and branch.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'The first message for the new session\'s agent. Make it self-contained: the new session cannot see this conversation.',
        },
        name: {
          type: 'string',
          description: 'Short human-readable session name, 2 to 4 words (e.g. "Fix login redirect"). Derived from the task when omitted.',
        },
        location: {
          type: 'string',
          enum: ['local', 'cloud'],
          description: '"local" (default) runs on this machine. "cloud" runs it in Claude Code on the web; requires a worktree.',
        },
        worktree: {
          type: 'boolean',
          description:
            'true (default): its own git worktree and branch. false: an agent in the project\'s main checkout with no branch of its own (local only).',
        },
        base_branch: {
          type: 'string',
          description: 'Branch to start the worktree from. Defaults to the repository\'s default branch.',
        },
        branch_name: {
          type: 'string',
          description: 'Name for the new branch. Defaults to session/<name>.',
        },
        mode: {
          type: 'string',
          enum: ['single-branch', 'orchestrator'],
          description:
            '"single-branch" (default) keeps the session to its own branch. "orchestrator" lets it create and push other branches too.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_sessions',
    description:
      'List the Crucible sessions in this project: id, name, branch, where each runs, and which session dispatched it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'send_to_session',
    description:
      'Send a message to another Crucible session in this project, as its next turn (it starts the session\'s agent if it is not running). Use the id from dispatch_session or list_sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'The target session id.' },
        message: { type: 'string', description: 'The message to send.' },
      },
      required: ['session_id', 'message'],
      additionalProperties: false,
    },
  },
]

const MAX_TASK_CHARS = 100_000

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`"${field}" must be a string`)
  const trimmed = value.trim()
  return trimmed || undefined
}

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Arguments must be an object')
  return value as Record<string, unknown>
}

/** Validate `dispatch_session` arguments (snake_case as the agent sends them). Throws with a message for the agent. */
export function parseDispatchSessionArgs(raw: unknown): DispatchSessionArgs {
  const args = asObject(raw)
  const task = optionalString(args.task, 'task')
  if (!task) throw new Error('"task" is required: describe what the new session should do')
  if (task.length > MAX_TASK_CHARS) throw new Error(`"task" is too long (max ${MAX_TASK_CHARS} characters)`)

  const location = args.location ?? 'local'
  if (location !== 'local' && location !== 'cloud') throw new Error('"location" must be "local" or "cloud"')

  const worktree = args.worktree ?? true
  if (typeof worktree !== 'boolean') throw new Error('"worktree" must be true or false')

  const mode = args.mode ?? 'single-branch'
  if (mode !== 'single-branch' && mode !== 'orchestrator') throw new Error('"mode" must be "single-branch" or "orchestrator"')

  const baseBranch = optionalString(args.base_branch, 'base_branch')
  const branchName = optionalString(args.branch_name, 'branch_name')

  if (!worktree) {
    if (location === 'cloud') throw new Error('A cloud session needs a worktree: drop "worktree": false or use location "local"')
    if (baseBranch || branchName) throw new Error('"base_branch" and "branch_name" need a worktree session')
    if (mode === 'orchestrator') throw new Error('"orchestrator" mode needs a worktree session')
  }

  return {
    task,
    name: optionalString(args.name, 'name'),
    location,
    worktree,
    baseBranch,
    branchName,
    mode,
  }
}

/** Validate `send_to_session` arguments. */
export function parseSendToSessionArgs(raw: unknown): SendToSessionArgs {
  const args = asObject(raw)
  const sessionId = optionalString(args.session_id, 'session_id')
  if (!sessionId) throw new Error('"session_id" is required')
  const message = optionalString(args.message, 'message')
  if (!message) throw new Error('"message" is required')
  if (message.length > MAX_TASK_CHARS) throw new Error(`"message" is too long (max ${MAX_TASK_CHARS} characters)`)
  return { sessionId, message }
}

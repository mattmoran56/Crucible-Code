/**
 * The app's built-in `crucible` MCP server: gives every interactive agent the
 * tools to start other Crucible sessions (local or cloud, worktree or not), see
 * which exist, message them, and assign a PR to a session with no worktree.
 *
 * Transport: MCP Streamable HTTP, stateless, JSON responses only (no SSE). It
 * is served by the notification server on 127.0.0.1 at `/mcp`, behind a bearer
 * token minted per app run. Each agent is pointed at it with `--mcp-config`,
 * which ADDS the server to the agent's own MCP servers rather than replacing
 * them, so a session keeps everything it would normally have. The URL carries
 * the agent's context id so a call knows which session asked.
 *
 * Tool calls are forwarded to the renderer (one window), which creates and
 * drives sessions through the same code paths as the UI and answers back.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  DISPATCH_MCP_INSTRUCTIONS,
  DISPATCH_MCP_SERVER_NAME,
  DISPATCH_TOOLS,
  parseDispatchSessionArgs,
  parseSendToSessionArgs,
  parseAssignPRArgs,
  type SessionDispatchRequest,
  type SessionDispatchResponse,
} from '../../shared/session-dispatch'

/** Path the notification server routes to handleMcpPost. */
export const MCP_PATH = '/mcp'

/** Protocol versions we answer with; the client's own when we know it. */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

/** Creating a worktree (and pushing for a cloud session) can take a while. */
export const DISPATCH_TIMEOUT_MS = 3 * 60_000

const token = randomBytes(24).toString('hex')
let port: number | null = null

type Sender = (req: SessionDispatchRequest) => boolean
let sender: Sender | null = null
const pending = new Map<
  string,
  { resolve: (r: SessionDispatchResponse) => void; timer: ReturnType<typeof setTimeout> }
>()

/** Set by the notification server once it is listening. */
export function setDispatchMcpPort(value: number | null): void {
  port = value
}

/** How requests reach the renderer. Returns false when no window can take one. */
export function setDispatchSender(fn: Sender | null): void {
  sender = fn
}

/**
 * `--mcp-config` args that add the `crucible` server to a `claude` process
 * started for `contextId`, or none when the server is not up.
 */
export function crucibleMcpArgs(contextId: string): string[] {
  if (!port || !contextId) return []
  const config = {
    mcpServers: {
      [DISPATCH_MCP_SERVER_NAME]: {
        type: 'http',
        url: `http://127.0.0.1:${port}${MCP_PATH}?context=${encodeURIComponent(contextId)}`,
        headers: { Authorization: `Bearer ${token}` },
      },
    },
  }
  return ['--mcp-config', JSON.stringify(config)]
}

/** Constant-time check of an `Authorization` header against this run's token. */
export function isAuthorized(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header[0] : header
  if (!value || !value.startsWith('Bearer ')) return false
  const given = Buffer.from(value.slice(7))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Settle a forwarded request with the renderer's answer. Unknown ids are ignored. */
export function resolveDispatchRequest(id: string, response: SessionDispatchResponse): void {
  const entry = pending.get(id)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(response)
}

/** A request before it is given an id (Omit distributed over the union). */
type ForwardedRequest = SessionDispatchRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never

function forward(req: ForwardedRequest, timeoutMs = DISPATCH_TIMEOUT_MS): Promise<SessionDispatchResponse> {
  const id = randomUUID()
  const full = { ...req, id } as SessionDispatchRequest
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: 'Crucible did not answer in time. Check the app: the session may still have been created.' })
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    let delivered = false
    try {
      delivered = !!sender?.(full)
    } catch {
      delivered = false
    }
    if (!delivered) {
      clearTimeout(timer)
      pending.delete(id)
      resolve({ ok: false, error: 'Crucible has no open window to create the session in. Open the app window and try again.' })
    }
  })
}

/* --- JSON-RPC ------------------------------------------------------------ */

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } }

const ok = (id: JsonRpcMessage['id'], result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: JsonRpcMessage['id'], code: number, message: string): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
})

const toolText = (text: string, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
})

async function callTool(contextId: string, name: unknown, rawArgs: unknown): Promise<ReturnType<typeof toolText>> {
  let response: SessionDispatchResponse
  try {
    if (name === 'dispatch_session') {
      response = await forward({ contextId, tool: 'dispatch_session', args: parseDispatchSessionArgs(rawArgs) })
    } else if (name === 'list_sessions') {
      response = await forward({ contextId, tool: 'list_sessions', args: {} }, 30_000)
    } else if (name === 'send_to_session') {
      response = await forward({ contextId, tool: 'send_to_session', args: parseSendToSessionArgs(rawArgs) }, 60_000)
    } else if (name === 'assign_pr') {
      response = await forward({ contextId, tool: 'assign_pr', args: parseAssignPRArgs(rawArgs) }, 60_000)
    } else {
      return toolText(`Unknown tool: ${String(name)}`, true)
    }
  } catch (err) {
    return toolText(err instanceof Error ? err.message : String(err), true)
  }
  return response.ok ? toolText(response.text) : toolText(response.error, true)
}

/** Answer one JSON-RPC message; null for a notification (nothing to send back). */
export async function handleMcpMessage(contextId: string, msg: JsonRpcMessage): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') {
    return fail(msg?.id, -32600, 'Invalid request')
  }
  const isNotification = msg.id === undefined || msg.id === null
  if (isNotification) return null

  switch (msg.method) {
    case 'initialize': {
      const requested = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : ''
      return ok(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: DISPATCH_MCP_SERVER_NAME, title: 'Crucible Code', version: '1.0.0' },
        instructions: DISPATCH_MCP_INSTRUCTIONS,
      })
    }
    case 'ping':
      return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, { tools: DISPATCH_TOOLS })
    case 'tools/call':
      return ok(msg.id, await callTool(contextId, msg.params?.name, msg.params?.arguments))
    case 'resources/list':
      return ok(msg.id, { resources: [] })
    case 'prompts/list':
      return ok(msg.id, { prompts: [] })
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

export interface McpHttpResult {
  status: number
  body?: unknown
}

/**
 * Handle one POST to `/mcp`: auth, then a single message or a batch.
 * Notifications alone get 202 with no body, per the Streamable HTTP transport.
 */
export async function handleMcpPost(
  authorization: string | string[] | undefined,
  contextId: string,
  rawBody: string
): Promise<McpHttpResult> {
  if (!isAuthorized(authorization)) return { status: 401, body: { error: 'unauthorized' } }
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { status: 400, body: fail(null, -32700, 'Parse error') }
  }
  if (Array.isArray(parsed)) {
    const answers = (await Promise.all(parsed.map((m) => handleMcpMessage(contextId, m as JsonRpcMessage)))).filter(
      (a): a is JsonRpcResponse => a !== null
    )
    return answers.length ? { status: 200, body: answers } : { status: 202 }
  }
  const answer = await handleMcpMessage(contextId, parsed as JsonRpcMessage)
  return answer ? { status: 200, body: answer } : { status: 202 }
}

/** Test hook: drop pending requests and the sender. */
export function _resetSessionDispatch(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer)
  pending.clear()
  sender = null
  port = null
}

/** Test hook: the bearer token of this run. */
export function _dispatchToken(): string {
  return token
}

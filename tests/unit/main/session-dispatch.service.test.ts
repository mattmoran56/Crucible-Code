import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { dock: { setBadge: () => {} }, setBadgeCount: () => {} },
  BrowserWindow: class {},
}))
vi.mock('../../../src/main/services/notification.service', () => ({
  showNotification: () => {},
}))
vi.mock('../../../src/main/services/event-bus', () => ({
  emitToRenderer: () => {},
}))
// launch.ts only needs the (empty) permission args from terminal.service.
vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
}))

import http from 'node:http'
import {
  _dispatchToken,
  _resetSessionDispatch,
  crucibleMcpArgs,
  handleMcpPost,
  isAuthorized,
  resolveDispatchRequest,
  setDispatchMcpPort,
  setDispatchSender,
} from '../../../src/main/services/session-dispatch.service'
import { startNotificationServer, stopNotificationServer } from '../../../src/main/services/notification-server'
import { agentArgv } from '../../../src/main/services/visual-agent/launch'
import { DISPATCH_MCP_INSTRUCTIONS } from '../../../src/shared/session-dispatch'
import type { SessionDispatchRequest } from '../../../src/shared/session-dispatch'

const auth = () => `Bearer ${_dispatchToken()}`
/** A JSON-RPC message; `id: null` makes it a notification. */
const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) })

beforeEach(() => _resetSessionDispatch())
afterEach(() => _resetSessionDispatch())

describe('crucibleMcpArgs', () => {
  it('is empty until the server has a port', () => {
    expect(crucibleMcpArgs('sess-1')).toEqual([])
  })

  it('points an http MCP server named crucible at /mcp with the context and token', () => {
    setDispatchMcpPort(4321)
    const args = crucibleMcpArgs('sess 1/x')
    expect(args[0]).toBe('--mcp-config')
    const config = JSON.parse(args[1])
    expect(Object.keys(config.mcpServers)).toEqual(['crucible'])
    const server = config.mcpServers.crucible
    expect(server.type).toBe('http')
    expect(server.url).toBe('http://127.0.0.1:4321/mcp?context=sess%201%2Fx')
    expect(server.headers.Authorization).toBe(auth())
  })

  it('never restricts the agent to only this server', () => {
    setDispatchMcpPort(4321)
    expect(crucibleMcpArgs('s')).not.toContain('--strict-mcp-config')
    const argv = agentArgv({ model: 'claude-opus-5-5', mcpArgs: crucibleMcpArgs('s') })
    expect(argv[argv.indexOf('--mcp-config') + 1]).toContain('"crucible"')
    expect(argv).not.toContain('--strict-mcp-config')
    expect(argv).not.toContain('--dangerously-skip-permissions')
    expect(argv).not.toContain('--permission-mode')
  })
})

describe('isAuthorized', () => {
  it('accepts only this run\'s bearer token', () => {
    expect(isAuthorized(auth())).toBe(true)
    expect(isAuthorized(undefined)).toBe(false)
    expect(isAuthorized('Bearer nope')).toBe(false)
    expect(isAuthorized(_dispatchToken())).toBe(false)
  })
})

describe('handleMcpPost', () => {
  it('rejects a request without the token', async () => {
    const res = await handleMcpPost(undefined, 'sess-1', rpc('tools/list'))
    expect(res.status).toBe(401)
  })

  it('answers initialize with the tools capability and the dispatch instructions', async () => {
    const res = await handleMcpPost(auth(), 'sess-1', rpc('initialize', { protocolVersion: '2025-03-26' }))
    expect(res.status).toBe(200)
    const body = res.body as { result: Record<string, any> }
    expect(body.result.protocolVersion).toBe('2025-03-26')
    expect(body.result.capabilities.tools).toBeDefined()
    expect(body.result.serverInfo.name).toBe('crucible')
    expect(body.result.instructions).toBe(DISPATCH_MCP_INSTRUCTIONS)
  })

  it('falls back to its latest protocol version for an unknown one', async () => {
    const res = await handleMcpPost(auth(), 'sess-1', rpc('initialize', { protocolVersion: '1999-01-01' }))
    expect((res.body as any).result.protocolVersion).toBe('2025-06-18')
  })

  it('acknowledges notifications with 202 and no body', async () => {
    const res = await handleMcpPost(auth(), 'sess-1', rpc('notifications/initialized', undefined, null))
    expect(res).toEqual({ status: 202 })
  })

  it('lists the three tools', async () => {
    const res = await handleMcpPost(auth(), 'sess-1', rpc('tools/list'))
    const names = (res.body as any).result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['dispatch_session', 'list_sessions', 'send_to_session'])
  })

  it('reports a parse error and unknown methods', async () => {
    expect((await handleMcpPost(auth(), 's', '{nope')).status).toBe(400)
    const res = await handleMcpPost(auth(), 's', rpc('nope/nope'))
    expect((res.body as any).error.code).toBe(-32601)
  })

  it('forwards dispatch_session to the renderer with the caller\'s context and returns its answer', async () => {
    const seen: SessionDispatchRequest[] = []
    setDispatchSender((req) => {
      seen.push(req)
      queueMicrotask(() => resolveDispatchRequest(req.id, { ok: true, text: 'Started session "X"' }))
      return true
    })
    const res = await handleMcpPost(
      auth(),
      'sess-1',
      rpc('tools/call', { name: 'dispatch_session', arguments: { task: 'Fix the login redirect', location: 'cloud' } })
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      contextId: 'sess-1',
      tool: 'dispatch_session',
      args: { task: 'Fix the login redirect', location: 'cloud', worktree: true, mode: 'single-branch' },
    })
    expect((res.body as any).result).toEqual({ content: [{ type: 'text', text: 'Started session "X"' }] })
  })

  it('returns a renderer error as a tool error', async () => {
    setDispatchSender((req) => {
      queueMicrotask(() => resolveDispatchRequest(req.id, { ok: false, error: 'branch exists' }))
      return true
    })
    const res = await handleMcpPost(auth(), 's', rpc('tools/call', { name: 'list_sessions', arguments: {} }))
    expect((res.body as any).result).toEqual({ content: [{ type: 'text', text: 'branch exists' }], isError: true })
  })

  it('refuses invalid arguments without bothering the renderer', async () => {
    const sender = vi.fn(() => true)
    setDispatchSender(sender)
    const res = await handleMcpPost(auth(), 's', rpc('tools/call', { name: 'dispatch_session', arguments: { location: 'cloud' } }))
    expect(sender).not.toHaveBeenCalled()
    expect((res.body as any).result.isError).toBe(true)
    expect((res.body as any).result.content[0].text).toContain('"task" is required')
  })

  it('says so when there is no window to create the session in', async () => {
    const res = await handleMcpPost(auth(), 's', rpc('tools/call', { name: 'dispatch_session', arguments: { task: 'x' } }))
    expect((res.body as any).result.isError).toBe(true)
    expect((res.body as any).result.content[0].text).toContain('no open window')
  })

  it('times out when the renderer never answers', async () => {
    vi.useFakeTimers()
    try {
      setDispatchSender(() => true)
      const pending = handleMcpPost(auth(), 's', rpc('tools/call', { name: 'list_sessions', arguments: {} }))
      await vi.advanceTimersByTimeAsync(31_000)
      const res = await pending
      expect((res.body as any).result.content[0].text).toContain('did not answer in time')
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers a batch', async () => {
    const res = await handleMcpPost(auth(), 's', `[${rpc('ping', undefined, 1)},${rpc('tools/list', undefined, 2)}]`)
    expect(res.status).toBe(200)
    expect((res.body as any[]).map((r) => r.id)).toEqual([1, 2])
  })
})

describe('notification server /mcp route', () => {
  afterEach(() => stopNotificationServer())

  const post = (port: number, path: string, body: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
        (res) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
        }
      )
      req.on('error', reject)
      req.end(body)
    })

  it('serves MCP on the notification server and wires the port into the agent config', async () => {
    const port = await startNotificationServer({} as any)
    const args = crucibleMcpArgs('sess-1')
    const server = JSON.parse(args[1]).mcpServers.crucible
    expect(server.url).toBe(`http://127.0.0.1:${port}/mcp?context=sess-1`)

    const denied = await post(port, '/mcp?context=sess-1', rpc('tools/list'))
    expect(denied.status).toBe(401)

    const res = await post(port, '/mcp?context=sess-1', rpc('tools/list'), { Authorization: server.headers.Authorization })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).result.tools).toHaveLength(3)
  })
})

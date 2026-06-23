import { beforeEach, describe, expect, it, vi } from 'vitest'

// notification-server pulls in electron + a couple of services at module load;
// stub them so the hook-event emitter can be tested in isolation. With no main
// window set and no registered context mapping, handleHookEvent's only
// observable effect is the in-process hook emit — exactly what we assert on.
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

import {
  handleHookEvent,
  onHookEvent,
  startNotificationServer,
  stopNotificationServer,
  setLocalPRCapture,
  registerContextMapping,
  removeContextMapping,
  type LocalPRCaptureArgs,
} from '../../../src/main/services/notification-server'
import http from 'node:http'

describe('notification-server onHookEvent', () => {
  it('fans a routed hook event out to subscribers', () => {
    const received: Array<{ contextId: string; tabId: string; hookType: string }> = []
    const off = onHookEvent((e) => received.push(e))

    handleHookEvent('sess-1', 'review-loop:r1:review', 'stop')

    expect(received).toEqual([
      { contextId: 'sess-1', tabId: 'review-loop:r1:review', hookType: 'stop' },
    ])
    off()
  })

  it('delivers to every active subscriber', () => {
    const a: string[] = []
    const b: string[] = []
    const offA = onHookEvent((e) => a.push(e.tabId))
    const offB = onHookEvent((e) => b.push(e.tabId))

    handleHookEvent('sess-1', 'review-loop:r2:fix', 'stop')

    expect(a).toEqual(['review-loop:r2:fix'])
    expect(b).toEqual(['review-loop:r2:fix'])
    offA()
    offB()
  })

  it('stops delivering after unsubscribe', () => {
    const received: string[] = []
    const off = onHookEvent((e) => received.push(e.hookType))

    handleHookEvent('sess-1', 'agent', 'notification')
    off()
    handleHookEvent('sess-1', 'agent', 'stop')

    expect(received).toEqual(['notification']) // the post-unsubscribe 'stop' is not delivered
  })

  it('forwards all hook types (prompt / notification / stop)', () => {
    const types: string[] = []
    const off = onHookEvent((e) => types.push(e.hookType))

    handleHookEvent('c', 't', 'prompt')
    handleHookEvent('c', 't', 'notification')
    handleHookEvent('c', 't', 'stop')

    expect(types).toEqual(['prompt', 'notification', 'stop'])
    off()
  })
})

describe('notification-server /local-pr endpoint', () => {
  let port = 0
  const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } } as any

  function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body)
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : null })
          })
        }
      )
      req.on('error', reject)
      req.write(data)
      req.end()
    })
  }

  beforeEach(async () => {
    port = await startNotificationServer(fakeWindow)
    registerContextMapping({ contextId: 'ctx-1', name: 'sess', kind: 'session', projectId: 'p1', worktreePath: '/wt' })
  })

  afterEach(() => {
    removeContextMapping('ctx-1')
    setLocalPRCapture(null)
    stopNotificationServer()
  })

  it('resolves the context, base64-decodes title/body, and returns the capture result', async () => {
    let captured: LocalPRCaptureArgs | null = null
    setLocalPRCapture(async (args) => {
      captured = args
      return { number: 7, url: 'https://github.com/local/local/pull/7' }
    })

    const res = await post('/local-pr?context=ctx-1&tab=agent', {
      action: 'create',
      title_b64: Buffer.from('My title').toString('base64'),
      body_b64: Buffer.from('Multi\nline').toString('base64'),
      have_title: 1,
      have_body: 1,
      base: 'main',
      head: 'feat/x',
      draft: true,
    })

    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ ok: true, number: 7, url: 'https://github.com/local/local/pull/7' })
    expect(captured).toBeTruthy()
    expect(captured!.action).toBe('create')
    expect(captured!.projectId).toBe('p1')
    expect(captured!.worktreePath).toBe('/wt')
    expect(captured!.fields.title).toBe('My title')
    expect(captured!.fields.body).toBe('Multi\nline')
    expect(captured!.fields.draft).toBe(true)
  })

  it('passes the view payload back as-is', async () => {
    setLocalPRCapture(async () => ({ ok: true, view_b64: 'Zm9v' } as any))
    const res = await post('/local-pr?context=ctx-1&tab=agent', { action: 'view', json: 'number' })
    expect(res.json.view_b64).toBe('Zm9v')
  })

  it('503s when no capture handler is registered', async () => {
    setLocalPRCapture(null)
    const res = await post('/local-pr?context=ctx-1&tab=agent', { action: 'create' })
    expect(res.status).toBe(503)
  })
})

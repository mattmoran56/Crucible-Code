import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory replacement for electron-store. The poller deliberately
// re-instantiates Store inside loadAllConfigs(), so we keep all "instances"
// pointing at the same shared backing object keyed by store name. That way
// re-instantiating still sees the latest data — matching real disk behaviour.
const stores: Record<string, Record<string, unknown>> = {}

class FakeStore<T extends Record<string, unknown>> {
  private name: string
  constructor(opts: { name?: string; defaults: T }) {
    this.name = opts.name ?? 'default'
    if (!stores[this.name]) stores[this.name] = JSON.parse(JSON.stringify(opts.defaults))
  }
  get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
    return (stores[this.name][key as string] ?? defaultValue) as T[K]
  }
  set<K extends keyof T>(key: K, value: T[K]): void {
    stores[this.name][key as string] = value
  }
}

const sentMessages: Array<{ channel: string; payload: unknown }> = []
const fakeWindow = {
  webContents: {
    send: (channel: string, payload: unknown) => {
      sentMessages.push({ channel, payload })
    },
  },
} as unknown as Electron.BrowserWindow

vi.mock('electron-store', () => ({ default: FakeStore }))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/codecrucible-test', isPackaged: false },
}))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/codecrucible-test' }))

const fetchMock = vi.fn()
;(globalThis as any).fetch = fetchMock

function fakeNotionResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    text: async () => text,
  } as Response
}

beforeEach(() => {
  // Reset shared store between tests.
  for (const k of Object.keys(stores)) delete stores[k]
  sentMessages.length = 0
  fetchMock.mockReset()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

async function loadFresh() {
  return await import('../../../src/main/services/notion-poller.service')
}

interface MockPage {
  id: string
  url?: string
  title?: string
}

function pageWithTitle(p: MockPage): Record<string, unknown> {
  return {
    id: p.id,
    url: p.url ?? `https://notion.so/${p.id}`,
    properties: {
      Task: {
        type: 'title',
        title: [{ plain_text: p.title ?? p.id }],
      },
      Status: {
        type: 'status',
        status: { name: 'Ready' },
      },
    },
  }
}

function mockQueryResponse(pages: MockPage[]): void {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes('/databases/') && url.endsWith('/query')) {
      return fakeNotionResponse(200, {
        results: pages.map(pageWithTitle),
        has_more: false,
        next_cursor: null,
      })
    }
    if (init?.method === 'PATCH') {
      // Property updates and append-blocks — succeed silently.
      return fakeNotionResponse(200, {})
    }
    return fakeNotionResponse(404, { message: 'unmocked: ' + url })
  })
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    apiToken: 'secret_x',
    databaseId: 'db1',
    filters: [],
    pickupUpdates: [],
    startupPromptTemplate: '/notion-ticket {{taskUrl}}',
    branchNameTemplate: 'notion/{{taskTitleSlug}}',
    ...overrides,
  }
}

describe('notion-poller.service — config + cache', () => {
  it('saveConfig persists and loadConfig reads it back', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig() as any)
    expect(poller.loadConfig('p1')).toMatchObject({ enabled: true, apiToken: 'secret_x' })
  })

  it('clearPickedUp removes only the given project', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig() as any)
    poller.saveConfig('p2', baseConfig() as any)
    mockQueryResponse([{ id: 'a' }, { id: 'b' }])
    await poller.seedPickedUpCache('p1')
    await poller.seedPickedUpCache('p2')
    poller.clearPickedUp('p1')
    // Re-poll: p1 should re-emit fires for the same pages; p2 still skips them.
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    const projectsFired = new Set(
      sentMessages.filter((m) => m.channel === 'notion:fire-task').map((m) => (m.payload as any).projectId)
    )
    expect(projectsFired.has('p1')).toBe(true)
    expect(projectsFired.has('p2')).toBe(false)
  })

  it('seedPickedUpCache caches every currently-matching id so they are not fired next tick', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig() as any)
    mockQueryResponse([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    await poller.seedPickedUpCache('p1')
    sentMessages.length = 0
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    expect(sentMessages.filter((m) => m.channel === 'notion:fire-task')).toHaveLength(0)
  })
})

describe('notion-poller.service — tick', () => {
  it('fires a NOTION_FIRE_TASK with resolved startup prompt for each new task', async () => {
    const poller = await loadFresh()
    poller.saveConfig(
      'p1',
      baseConfig({
        startupPromptTemplate: '/notion-ticket {{taskUrl}} for {{taskTitle}}',
      }) as any
    )
    mockQueryResponse([{ id: 'page-1', title: 'Hello World', url: 'https://notion.so/page-1' }])

    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()

    const fires = sentMessages.filter((m) => m.channel === 'notion:fire-task')
    expect(fires).toHaveLength(1)
    const payload = fires[0].payload as any
    expect(payload.projectId).toBe('p1')
    expect(payload.page.id).toBe('page-1')
    expect(payload.page.title).toBe('Hello World')
    expect(payload.resolvedStartupPrompt).toBe('/notion-ticket https://notion.so/page-1 for Hello World')
    expect(payload.suggestedBranchName).toBe('notion/hello-world')
  })

  it('does not re-fire a task that was already picked up in a prior tick', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig() as any)
    mockQueryResponse([{ id: 'page-1', title: 'A' }])
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    expect(sentMessages.filter((m) => m.channel === 'notion:fire-task')).toHaveLength(1)

    // Now manually drive a second tick — the loaded config still has the
    // same DB returning the same page, but it should not refire.
    sentMessages.length = 0
    // Triggering by re-starting the poller exercises the same code path.
    poller.stopNotionPoller()
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    expect(sentMessages.filter((m) => m.channel === 'notion:fire-task')).toHaveLength(0)
  })

  it('caps fires per tick to prevent runaway session spawning', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig() as any)
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `page-${i}`, title: `t${i}` }))
    mockQueryResponse(many)
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 10))
    poller.stopNotionPoller()
    const fires = sentMessages.filter((m) => m.channel === 'notion:fire-task')
    expect(fires.length).toBeLessThanOrEqual(5)
  })

  it('skips disabled projects entirely', async () => {
    const poller = await loadFresh()
    poller.saveConfig('p1', baseConfig({ enabled: false }) as any)
    mockQueryResponse([{ id: 'page-1' }])
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sentMessages.filter((m) => m.channel === 'notion:fire-task')).toHaveLength(0)
  })

  it('keeps the page in the cache when the immediate property-update fails (does not fire a doomed session)', async () => {
    const poller = await loadFresh()
    poller.saveConfig(
      'p1',
      baseConfig({
        pickupUpdates: [{ property: 'Status', type: 'status', value: 'In Progress' }],
      }) as any
    )
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/query')) {
        return fakeNotionResponse(200, {
          results: [pageWithTitle({ id: 'page-1' })],
          has_more: false,
          next_cursor: null,
        })
      }
      if (init?.method === 'PATCH') {
        return fakeNotionResponse(401, { message: 'Unauthorized' })
      }
      return fakeNotionResponse(404, {})
    })
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    const fires = sentMessages.filter((m) => m.channel === 'notion:fire-task')
    expect(fires).toHaveLength(0)
    // Second start — same conditions, must still not fire (page is cached).
    sentMessages.length = 0
    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()
    expect(sentMessages.filter((m) => m.channel === 'notion:fire-task')).toHaveLength(0)
  })
})

describe('notion-poller.service — applyWriteBack', () => {
  it('only applies updates that reference {{branch}}/{{sessionId}} after session creation', async () => {
    const poller = await loadFresh()
    poller.saveConfig(
      'p1',
      baseConfig({
        pickupUpdates: [
          { property: 'Status', type: 'status', value: 'In Progress' },
          { property: 'Branch', type: 'url', value: 'https://example.com/{{branch}}' },
        ],
      }) as any
    )

    const patchCalls: Array<{ url: string; body: any }> = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patchCalls.push({ url, body: JSON.parse(init.body as string) })
        return fakeNotionResponse(200, {})
      }
      if (url.endsWith('/query')) {
        return fakeNotionResponse(200, { results: [pageWithTitle({ id: 'page-1' })] })
      }
      return fakeNotionResponse(404, {})
    })

    poller.startNotionPoller(fakeWindow)
    await new Promise((r) => setTimeout(r, 5))
    poller.stopNotionPoller()

    // First PATCH = immediate updates only (Status).
    expect(patchCalls).toHaveLength(1)
    expect(patchCalls[0].body).toEqual({
      properties: { Status: { status: { name: 'In Progress' } } },
    })

    // Now the write-back should apply the deferred Branch URL update.
    await poller.applyWriteBack(
      'p1',
      { id: 'page-1', url: 'https://notion.so/page-1', title: 'Hello', rawProperties: {} },
      'notion/hello-world',
      'sess-xyz',
    )
    expect(patchCalls).toHaveLength(2)
    expect(patchCalls[1].body).toEqual({
      properties: { Branch: { url: 'https://example.com/notion/hello-world' } },
    })
  })

  it('appends markdown blocks when configured', async () => {
    const poller = await loadFresh()
    poller.saveConfig(
      'p1',
      baseConfig({
        pickupAppendMarkdown: 'Picked up by Crucible on branch {{branch}}',
      }) as any
    )

    const calls: Array<{ url: string; body: any }> = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        calls.push({ url, body: JSON.parse(init.body as string) })
        return fakeNotionResponse(200, {})
      }
      if (url.endsWith('/query')) {
        return fakeNotionResponse(200, { results: [] })
      }
      return fakeNotionResponse(404, {})
    })

    await poller.applyWriteBack(
      'p1',
      { id: 'page-1', url: 'https://notion.so/page-1', title: 'Hi', rawProperties: {} },
      'notion/hi',
      's1',
    )

    const blockCall = calls.find((c) => c.url.includes('/blocks/'))
    expect(blockCall).toBeDefined()
    const richText = blockCall!.body.children[0].paragraph.rich_text
    const joined = richText.map((s: any) => s.text.content).join('')
    expect(joined).toContain('Picked up by Crucible on branch notion/hi')
  })
})

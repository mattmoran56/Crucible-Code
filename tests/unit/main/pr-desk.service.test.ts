import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loadConfig = vi.fn()
vi.mock('../../../src/main/services/notion-poller.service', () => ({ loadConfig: (...a: unknown[]) => loadConfig(...a) }))
vi.mock('../../../src/main/services/github.service', () => ({ getRepoOwnerName: vi.fn() }))

import {
  clearDeskCaches,
  getDeskTickets,
  mapDeskPR,
  pageToDeskTicket,
} from '../../../src/main/services/pr-desk.service'

const PAGE = '40ec9cf4af0180f898c2ed0a9f09e286'

const rawPR = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'ENG-12 Add counts',
  body: `## Notion Ticket\n[Add counts](https://www.notion.so/${PAGE}) (ENG-12)`,
  isDraft: false,
  url: 'https://github.com/o/r/pull/7',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  headRefName: 'feat',
  baseRefName: 'main',
  mergeable: 'CONFLICTING',
  author: { login: 'alice' },
  assignees: { nodes: [{ login: 'bob' }] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'carol' } }, { requestedReviewer: { name: 'core' } }, { requestedReviewer: null }] },
  labels: { nodes: [{ name: 'bug', color: 'ff0000', description: null }] },
  commits: { nodes: [{ commit: { committedDate: '2026-11-02T09:00:00Z', statusCheckRollup: { state: 'FAILURE' } } }] },
  reviews: { nodes: [] },
  comments: {
    totalCount: 5,
    nodes: [{ author: { login: 'github-actions' }, body: 'Automated review feedback\nVERDICT: approve', createdAt: '2026-11-02T10:00:00Z' }],
  },
  ...over,
})

describe('mapDeskPR', () => {
  it('flattens the GraphQL shape and derives review state and ticket', () => {
    const pr = mapDeskPR(rawPR() as never)
    expect(pr).toMatchObject({
      number: 7,
      author: 'alice',
      assignees: ['bob'],
      requestedReviewers: ['carol', 'core'],
      ciStatus: 'failure',
      mergeable: 'conflicting',
      commentsCount: 5,
      labels: [{ name: 'bug', color: 'ff0000' }],
      ticket: { ticketId: 'ENG-12', pageId: PAGE },
    })
    expect(pr.review.approved).toBe('auto')
  })

  it('maps rollup states and missing commits', () => {
    expect(mapDeskPR(rawPR({ commits: { nodes: [] } }) as never).ciStatus).toBe('none')
    const pending = rawPR({ commits: { nodes: [{ commit: { committedDate: 'x', statusCheckRollup: { state: 'PENDING' } } }] } })
    expect(mapDeskPR(pending as never).ciStatus).toBe('pending')
    expect(mapDeskPR(rawPR({ mergeable: 'UNKNOWN' }) as never).mergeable).toBe('unknown')
  })
})

const notionPage = {
  id: '40ec9cf4-af01-80f8-98c2-ed0a9f09e286',
  url: `https://www.notion.so/Add-counts-${PAGE}`,
  properties: {
    'Task name': { type: 'title', title: [{ plain_text: 'Add counts' }] },
    Status: { type: 'status', status: { name: 'In review' } },
    ID: { type: 'unique_id', unique_id: { prefix: 'ENG', number: 12 } },
    Assign: { type: 'people', people: [{ name: 'Alice' }] },
    Sprint: { type: 'relation', relation: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] },
    Project: { type: 'relation', relation: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }] },
  },
}
const PROJECT = 'b'.repeat(32)
const projectPage = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  url: 'https://www.notion.so/Review-workflow-' + PROJECT,
  created_time: '2026-09-01T00:00:00.000Z',
  properties: { Name: { type: 'title', title: [{ plain_text: 'Review workflow' }] } },
}

describe('pageToDeskTicket', () => {
  it('reads title, status, ticket id and assignees', () => {
    expect(pageToDeskTicket(notionPage)).toEqual({
      pageId: PAGE,
      ticketId: 'ENG-12',
      title: 'Add counts',
      status: 'In review',
      url: notionPage.url,
      assignees: ['Alice'],
      projectId: PROJECT,
    })
  })
})

describe('getDeskTickets', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    clearDeskCaches()
    fetchMock.mockReset()
    loadConfig.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) })

  it('reports unconfigured when the project has no Notion token', async () => {
    loadConfig.mockReturnValue(null)
    expect(await getDeskTickets('p', [{ ticketId: 'ENG-1', pageId: null, url: null }])).toEqual({ configured: false, tickets: {}, projects: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches pages by id, then their projects, and caches both', async () => {
    loadConfig.mockReturnValue({ apiToken: 't', databaseId: 'db' })
    fetchMock.mockImplementation(async (url: string) => ok(url.includes('/pages/bbbbbbbb') ? projectPage : notionPage))
    const ref = { ticketId: 'ENG-12', pageId: PAGE, url: null }
    const first = await getDeskTickets('p', [ref, ref])
    expect(first.tickets[PAGE].status).toBe('In review')
    expect(first.projects[PROJECT]).toEqual({
      id: PROJECT,
      title: 'Review workflow',
      url: projectPage.url,
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/pages/40ec9cf4-af01-80f8-98c2-ed0a9f09e286')
    await getDeskTickets('p', [ref])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('looks up a bare ticket id by the database unique ID, only for its prefix', async () => {
    loadConfig.mockReturnValue({ apiToken: 't', databaseId: '0123456789abcdef0123456789abcdef' })
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/query')
        ? ok({ results: [notionPage] })
        : ok({ properties: { ID: { type: 'unique_id', unique_id: { prefix: 'ENG' } } } })
    )
    const res = await getDeskTickets('p', [
      { ticketId: 'ENG-12', pageId: null, url: null },
      { ticketId: 'UTF-8', pageId: null, url: null },
    ])
    expect(Object.keys(res.tickets)).toEqual(['ENG-12'])
    const query = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/query'))!
    expect(JSON.parse(query[1].body).filter).toEqual({ property: 'ID', unique_id: { equals: 12 } })
  })

  it('returns the first error but keeps the tickets that loaded', async () => {
    loadConfig.mockReturnValue({ apiToken: 't', databaseId: 'db' })
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found', text: async () => '{"message":"not shared"}' })
      .mockResolvedValueOnce(ok(notionPage))
      .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found', text: async () => '{}' })
    const res = await getDeskTickets('p', [
      { ticketId: null, pageId: 'a'.repeat(32), url: null },
      { ticketId: null, pageId: PAGE, url: null },
    ])
    expect(res.error).toContain('404')
    expect(res.tickets[PAGE]).toBeDefined()
    // The project page isn't shared: no row for it, and no error for the desk.
    expect(res.projects).toEqual({})
  })
})

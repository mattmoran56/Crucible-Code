import { describe, expect, it } from 'vitest'
import {
  deriveReviewState,
  deskStageOf,
  deskToPullRequest,
  involvesMe,
  pageIdFromUrl,
  parkedReason,
  parseTicketRef,
  ticketKey,
  type DeskPR,
} from '../../../src/shared/prDesk'

const PAGE = '40ec9cf4af0180f898c2ed0a9f09e286'

const pr = (p: Partial<DeskPR> = {}): DeskPR => ({
  number: 1,
  title: 'A change',
  url: 'https://github.com/o/r/pull/1',
  author: 'me',
  isDraft: false,
  assignees: [],
  requestedReviewers: [],
  labels: [],
  headRefName: 'feat',
  baseRefName: 'main',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  ciStatus: 'success',
  mergeable: 'mergeable',
  commentsCount: 0,
  review: deriveReviewState({ comments: [], reviews: [], lastCommitAt: null, labels: [] }),
  ticket: null,
  ...p,
})

const approved = (by: 'human' | 'auto') =>
  ({ ...pr().review, approved: by }) as DeskPR['review']

describe('pageIdFromUrl', () => {
  it('takes the trailing 32-hex id from a Notion URL', () => {
    expect(pageIdFromUrl(`https://www.notion.so/Some-title-${PAGE}?pvs=4`)).toBe(PAGE)
  })
  it('accepts dashed ids', () => {
    expect(pageIdFromUrl('40ec9cf4-af01-80f8-98c2-ed0a9f09e286')).toBe(PAGE)
  })
  it('returns null for a URL without an id', () => {
    expect(pageIdFromUrl('https://www.notion.so/workspace')).toBeNull()
  })
})

describe('parseTicketRef', () => {
  it('prefers the ticket bot comment', () => {
    const ref = parseTicketRef('ENG-1 title', '', [
      { body: '<!-- notion-tickets-comment -->\n| `ENG-42` | Thing | [Open](https://www.notion.so/' + PAGE + ') |' },
    ])
    expect(ref).toEqual({ ticketId: 'ENG-42', pageId: PAGE, url: `https://www.notion.so/${PAGE}` })
  })

  it('reads the Notion Ticket section of the body', () => {
    const body = `# Feature\n\n## Notion Ticket\n\n[Add counts](https://www.notion.so/${PAGE}) (ENG-4855)\n\n## Description\nENG-9`
    expect(parseTicketRef('Add counts', body)).toEqual({
      ticketId: 'ENG-4855',
      pageId: PAGE,
      url: `https://www.notion.so/${PAGE}`,
    })
  })

  it('falls back to any Notion link, then a ticket id in the title', () => {
    expect(parseTicketRef('ENG-7: fix', `see https://notion.so/${PAGE}.`)?.pageId).toBe(PAGE)
    expect(parseTicketRef('ENG-7: fix', 'no links')).toEqual({ ticketId: 'ENG-7', pageId: null, url: null })
  })

  it('reads app.notion.com links (bot comment and body)', () => {
    const url = `https://app.notion.com/p/Navigator-summary-${PAGE}`
    expect(parseTicketRef('fix', '', [
      { body: `<!-- notion-tickets-comment -->\n| \`ENG-4815\` | ENG-4815 | [Open in Notion](${url}) |` },
    ])).toEqual({ ticketId: 'ENG-4815', pageId: PAGE, url })
    expect(parseTicketRef('fix', `## Notion Ticket\n\nNo ticket yet. See https://app.notion.com/p/${PAGE}`)?.pageId).toBe(PAGE)
  })

  it('returns null when nothing names a ticket', () => {
    expect(parseTicketRef('Tidy up', 'Just a refactor')).toBeNull()
  })
})

describe('deriveReviewState', () => {
  const verdict = (v: string, at: string) => ({
    author: 'github-actions',
    body: `## Automated review feedback\n\nVERDICT: ${v}`,
    createdAt: at,
  })

  it('counts an auto-review approval on the current head', () => {
    const rs = deriveReviewState({
      comments: [verdict('approve', '2026-11-02T10:00:00Z')],
      reviews: [],
      lastCommitAt: '2026-11-02T09:00:00Z',
      labels: [],
    })
    expect(rs.approved).toBe('auto')
    expect(rs.autoCurrent).toBe(true)
  })

  it('marks an approval before the latest commit as stale', () => {
    const rs = deriveReviewState({
      comments: [verdict('approve', '2026-11-02T08:00:00Z')],
      reviews: [],
      lastCommitAt: '2026-11-02T09:00:00Z',
      labels: [],
    })
    expect(rs.approved).toBe('stale')
  })

  it('reads the bot verdict from a GitHub review too', () => {
    const rs = deriveReviewState({
      comments: [],
      reviews: [{ author: 'github-actions[bot]', state: 'APPROVED', submittedAt: '2026-11-02T10:00:00Z' }],
      lastCommitAt: '2026-11-02T09:00:00Z',
      labels: [],
    })
    expect(rs.approved).toBe('auto')
  })

  it("puts a person's approval first, and their latest review wins", () => {
    expect(
      deriveReviewState({
        comments: [],
        reviews: [{ author: 'bob', state: 'APPROVED', submittedAt: '2026-11-02T10:00:00Z' }],
        lastCommitAt: null,
        labels: [],
      }).approved
    ).toBe('human')
    expect(
      deriveReviewState({
        comments: [],
        reviews: [
          { author: 'bob', state: 'APPROVED', submittedAt: '2026-11-02T10:00:00Z' },
          { author: 'carol', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02T11:00:00Z' },
        ],
        lastCommitAt: null,
        labels: [],
      }).approved
    ).toBe('changes')
  })

  it('reads the review requirement from labels', () => {
    const base = { comments: [], reviews: [], lastCommitAt: null }
    expect(deriveReviewState({ ...base, labels: ['review:human-required'] }).requirement).toBe('human')
    expect(deriveReviewState({ ...base, labels: ['review:automated-ok'] }).requirement).toBe('auto')
  })
})

describe('deskStageOf', () => {
  const ctx = { me: 'me', parked: new Set<number>() }

  it('parks a PR parked by hand above everything else', () => {
    expect(deskStageOf(pr({ isDraft: true }), { ...ctx, parked: new Set([1]) })).toBe('parked')
  })

  it('puts drafts in Draft', () => {
    expect(deskStageOf(pr({ isDraft: true }), ctx)).toBe('draft')
  })

  it('parks by label or ticket status', () => {
    expect(deskStageOf(pr({ labels: [{ name: 'on-hold', color: '' }] }), ctx)).toBe('parked')
    const ticket = { pageId: PAGE, ticketId: 'ENG-1', title: 't', status: 'Deprioritised', url: '', assignees: [], projectId: null }
    expect(deskStageOf(pr(), { ...ctx, ticket })).toBe('parked')
    expect(parkedReason(pr(), { ...ctx, ticket })).toBe('Ticket status “Deprioritised”')
  })

  it('moves PRs handed to someone else to Assigned', () => {
    expect(deskStageOf(pr({ assignees: ['bob'] }), ctx)).toBe('assigned')
    expect(deskStageOf(pr({ requestedReviewers: ['bob'] }), ctx)).toBe('assigned')
    expect(deskStageOf(pr({ assignees: ['me'], review: approved('auto') }), ctx)).toBe('ready')
  })

  it('needs green CI, an approval and no conflicts for Ready', () => {
    expect(deskStageOf(pr({ review: approved('human') }), ctx)).toBe('ready')
    expect(deskStageOf(pr({ review: approved('human'), ciStatus: 'pending' }), ctx)).toBe('pending')
    expect(deskStageOf(pr({ review: approved('auto'), mergeable: 'conflicting' }), ctx)).toBe('pending')
    expect(deskStageOf(pr(), ctx)).toBe('pending')
  })
})

describe('involvesMe / ticketKey / deskToPullRequest', () => {
  it('matches author, assignee or reviewer, case-insensitively', () => {
    expect(involvesMe(pr({ author: 'Me' }), 'me')).toBe(true)
    expect(involvesMe(pr({ author: 'bob', requestedReviewers: ['ME'] }), 'me')).toBe(true)
    expect(involvesMe(pr({ author: 'bob' }), 'me')).toBe(false)
    expect(involvesMe(pr(), null)).toBe(false)
  })

  it('keys tickets by page id, else ticket id', () => {
    expect(ticketKey({ ticketId: 'ENG-1', pageId: PAGE, url: null })).toBe(PAGE)
    expect(ticketKey({ ticketId: 'ENG-1', pageId: null, url: null })).toBe('ENG-1')
  })

  it('converts to the sidebar PullRequest shape', () => {
    const out = deskToPullRequest(pr({ number: 9, headRefName: 'x' }))
    expect(out).toMatchObject({ number: 9, headRefName: 'x', state: 'OPEN', reviews: [] })
  })
})

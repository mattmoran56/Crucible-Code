import type { CIStatus, PRLabel, PullRequest } from './types'

/**
 * PR Desk: the open PRs sorted into the stages a reviewer works through, each
 * with its Notion ticket. The rules are the ones PR Desk (the standalone board)
 * uses, so a PR sits in the same column in both.
 */

export type DeskStage = 'draft' | 'pending' | 'ready' | 'assigned' | 'parked'

export const DESK_STAGES: Array<{ id: DeskStage; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'pending', label: 'Pending' },
  { id: 'ready', label: 'Ready for me' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'parked', label: 'Parked' },
]

export const DESK_RULES = {
  /** A label matching this parks the PR. */
  parkedLabelRegex: /hold|blocked|parked|delayed|deprioriti|later|wip/i,
  /** A ticket in one of these statuses parks the PR (compared case-insensitively). */
  parkedStatuses: ['deprioritised'],
  /** The bot whose comments (or reviews) carry the auto-review verdict. */
  autoReviewLogin: 'github-actions',
  autoReviewMarker: /Automated review(?:\s+feedback)?[\s\S]*?VERDICT:\s*([a-z-]+)/i,
  /** The ticket-linking bot comment carries this marker. */
  botCommentMarker: '<!-- notion-tickets-comment -->',
  humanRequiredLabel: 'review:human-required',
  autoOkLabel: 'review:automated-ok',
}

export type DeskApproval = 'human' | 'auto' | 'changes' | 'stale' | null

export interface DeskReviewState {
  /** The latest auto-review verdict ("approve", "request-changes"), or null. */
  auto: string | null
  /** The verdict was posted after the last commit. */
  autoCurrent: boolean
  humanApprovers: string[]
  humanChangesRequested: boolean
  requirement: 'human' | 'auto' | null
  approved: DeskApproval
}

export interface DeskTicketRef {
  /** "ENG-1234", when the PR names one. */
  ticketId: string | null
  /** 32-hex Notion page id, lowercase, no dashes. */
  pageId: string | null
  url: string | null
}

export type DeskMergeable = 'mergeable' | 'conflicting' | 'unknown'

export interface DeskPR {
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  assignees: string[]
  requestedReviewers: string[]
  labels: PRLabel[]
  headRefName: string
  baseRefName: string
  createdAt: string
  updatedAt: string
  ciStatus: CIStatus
  mergeable: DeskMergeable
  commentsCount: number
  review: DeskReviewState
  ticket: DeskTicketRef | null
}

export interface DeskTicket {
  pageId: string
  ticketId: string | null
  title: string
  status: string | null
  url: string
  assignees: string[]
  /** The Notion project the ticket belongs to (32-hex page id), from its Project relation. */
  projectId: string | null
}

/** A Notion project page: the expanded desk has one row per project. */
export interface DeskProject {
  id: string
  title: string
  url: string
  createdAt: string | null
}

export interface DeskTicketsResult {
  /** The project has a Notion token and database set. */
  configured: boolean
  /** Keyed by `ticketKey(ref)`. */
  tickets: Record<string, DeskTicket>
  /** The tickets' Notion projects, keyed by id. */
  projects: Record<string, DeskProject>
  error?: string
}

/** Cache key for a ticket ref: the page id when known, else the ticket id. */
export function ticketKey(ref: DeskTicketRef): string | null {
  return ref.pageId ?? ref.ticketId ?? null
}

// ── Review state ────────────────────────────────────────────────────────────

export interface ReviewInput {
  comments: Array<{ author: string; body: string; createdAt: string }>
  reviews: Array<{ author: string; state: string; submittedAt: string }>
  lastCommitAt: string | null
  labels: string[]
}

function isAutoReviewer(login: string): boolean {
  return login === DESK_RULES.autoReviewLogin || login === `${DESK_RULES.autoReviewLogin}[bot]`
}

/**
 * Who has approved the PR, and whether the auto-review's verdict is on the
 * current head. A person's approval outranks the auto-review; a verdict posted
 * before the latest commit never counts as approval.
 */
export function deriveReviewState(input: ReviewInput): DeskReviewState {
  let auto: { verdict: string; at: string } | null = null
  for (const c of input.comments) {
    if (!isAutoReviewer(c.author)) continue
    const m = DESK_RULES.autoReviewMarker.exec(c.body || '')
    if (m && (!auto || c.createdAt > auto.at)) auto = { verdict: m[1].toLowerCase(), at: c.createdAt }
  }
  const latest = new Map<string, string>()
  const sorted = [...input.reviews].sort((a, b) => (a.submittedAt || '').localeCompare(b.submittedAt || ''))
  for (const r of sorted) {
    if (!r.author) continue
    // The bot sometimes files its verdict as a GitHub review rather than a comment.
    if (isAutoReviewer(r.author)) {
      const v = r.state === 'APPROVED' ? 'approve' : r.state === 'CHANGES_REQUESTED' ? 'request-changes' : null
      if (v && (!auto || r.submittedAt > auto.at)) auto = { verdict: v, at: r.submittedAt }
      continue
    }
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') latest.set(r.author, r.state)
  }
  const humanApprovers = [...latest].filter(([, s]) => s === 'APPROVED').map(([l]) => l)
  const humanChangesRequested = [...latest.values()].includes('CHANGES_REQUESTED')
  const humanApproved = humanApprovers.length > 0 && !humanChangesRequested
  const autoCurrent = !!(auto && (!input.lastCommitAt || auto.at > input.lastCommitAt))
  const verdict = auto ? auto.verdict : null
  const requirement = input.labels.includes(DESK_RULES.humanRequiredLabel)
    ? 'human'
    : input.labels.includes(DESK_RULES.autoOkLabel)
      ? 'auto'
      : null

  let approved: DeskApproval = null
  if (humanApproved) approved = 'human'
  else if (verdict === 'approve' && autoCurrent && !humanChangesRequested) approved = 'auto'
  else if (humanChangesRequested || (verdict === 'request-changes' && autoCurrent)) approved = 'changes'
  else if (verdict === 'approve') approved = 'stale'

  return { auto: verdict, autoCurrent, humanApprovers, humanChangesRequested, requirement, approved }
}

// ── Ticket links ────────────────────────────────────────────────────────────

const TICKET_ID_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g
const NOTION_URL_RE = /https?:\/\/(?:[a-z0-9-]+\.)?(?:notion\.so|notion\.site|app\.notion\.com)\/[^\s)\]>"'<]+/gi

/** 32-hex Notion page id from a URL, dashed UUID or bare id; else null. */
export function pageIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const s = String(url).trim().replace(/[?#].*$/, '')
  const all = s.match(
    /(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi
  )
  return all ? all[all.length - 1].replace(/-/g, '').toLowerCase() : null
}

function ticketIds(text: string): string[] {
  return [...new Set((text.match(TICKET_ID_RE) ?? []).map((s) => s.toUpperCase()))]
}

function notionUrls(text: string): Array<{ url: string; pageId: string }> {
  const out: Array<{ url: string; pageId: string }> = []
  for (const m of text.matchAll(NOTION_URL_RE)) {
    const url = m[0].replace(/[.,;:]+$/, '')
    const pageId = pageIdFromUrl(url)
    if (pageId) out.push({ url, pageId })
  }
  return out
}

/** Text of the `## Notion Ticket` section of a PR body, up to the next h1/h2. */
function notionSection(body: string): string {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((l) => /^\s{0,3}#{1,6}\s*notion\s+tickets?\b/i.test(l))
  if (start < 0) return ''
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s{0,3}#{1,2}\s/.test(lines[i])) break
    out.push(lines[i])
  }
  return out.join('\n')
}

/**
 * The PR's primary ticket, from (in order) the ticket bot's comment, the body's
 * `## Notion Ticket` section, any Notion link in the body, then a ticket id in
 * the title. Branch names never count.
 */
export function parseTicketRef(
  title: string,
  body: string,
  comments: Array<{ body: string }> = []
): DeskTicketRef | null {
  const bot = [...comments].reverse().find((c) => c.body?.includes(DESK_RULES.botCommentMarker))
  if (bot) {
    for (const line of bot.body.split(/\r?\n/)) {
      const urls = notionUrls(line)
      const ids = ticketIds(line)
      if (urls.length && ids.length) return { ticketId: ids[0], pageId: urls[0].pageId, url: urls[0].url }
    }
  }

  const section = notionSection(body || '')
  if (section) {
    const urls = notionUrls(section)
    const ids = ticketIds(section)
    if (urls.length || ids.length) {
      return { ticketId: ids[0] ?? null, pageId: urls[0]?.pageId ?? null, url: urls[0]?.url ?? null }
    }
  }

  const bodyUrls = notionUrls(body || '')
  const titleIds = ticketIds(title || '')
  if (bodyUrls.length) return { ticketId: titleIds[0] ?? null, pageId: bodyUrls[0].pageId, url: bodyUrls[0].url }
  if (titleIds.length) return { ticketId: titleIds[0], pageId: null, url: null }
  return null
}

// ── Stages ──────────────────────────────────────────────────────────────────

export interface StageContext {
  /** The signed-in GitHub login. */
  me: string | null
  /** PR numbers the user parked by hand. */
  parked: ReadonlySet<number>
  /** The PR's ticket, once loaded. */
  ticket?: DeskTicket | null
}

const lc = (s: string | null | undefined) => (s ?? '').toLowerCase()

/**
 * Why a PR is parked: a manual hold, a parking label, or a parked ticket
 * status. Null when it isn't.
 */
export function parkedReason(pr: DeskPR, ctx: StageContext): string | null {
  if (ctx.parked.has(pr.number)) return 'Parked by you'
  const label = pr.labels.find((l) => DESK_RULES.parkedLabelRegex.test(l.name))
  if (label) return `Label “${label.name}”`
  const status = ctx.ticket?.status
  if (status && DESK_RULES.parkedStatuses.includes(lc(status))) return `Ticket status “${status}”`
  return null
}

/**
 * The stage a PR sits in, first match wins: parked by hand, draft, parked by
 * label or ticket status, handed to someone else, ready (CI green, approved,
 * no conflicts), else pending.
 */
export function deskStageOf(pr: DeskPR, ctx: StageContext): DeskStage {
  if (ctx.parked.has(pr.number)) return 'parked'
  if (pr.isDraft) return 'draft'
  if (parkedReason(pr, ctx)) return 'parked'
  const me = lc(ctx.me)
  const others = (list: string[]) => list.some((l) => lc(l) !== me)
  if (others(pr.assignees) || others(pr.requestedReviewers)) return 'assigned'
  if (pr.mergeable === 'conflicting') return 'pending'
  const approved = pr.review.approved === 'human' || pr.review.approved === 'auto'
  if (approved && pr.ciStatus === 'success') return 'ready'
  return 'pending'
}

/** The PR involves me: I wrote it, am assigned, or am asked to review. */
export function involvesMe(pr: DeskPR, me: string | null): boolean {
  if (!me) return false
  const L = lc(me)
  return lc(pr.author) === L || pr.assignees.some((a) => lc(a) === L) || pr.requestedReviewers.some((r) => lc(r) === L)
}

/** A `PullRequest` for code paths (open PR, notifications) that take the sidebar's shape. */
export function deskToPullRequest(pr: DeskPR): PullRequest {
  return {
    number: pr.number,
    title: pr.title,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName,
    author: pr.author,
    assignees: pr.assignees,
    requestedReviewers: pr.requestedReviewers,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    isDraft: pr.isDraft,
    state: 'OPEN',
    ciStatus: pr.ciStatus,
    labels: pr.labels,
    commentsCount: pr.commentsCount,
    reviews: [],
  }
}

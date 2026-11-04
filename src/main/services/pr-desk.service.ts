import { execFile } from 'child_process'
import { promisify } from 'util'
import type { CIStatus } from '../../shared/types'
import {
  deriveReviewState,
  parseTicketRef,
  ticketKey,
  type DeskMergeable,
  type DeskPR,
  type DeskTicket,
  type DeskTicketRef,
  type DeskTicketsResult,
} from '../../shared/prDesk'
import { getRepoOwnerName } from './github.service'
import { extractTitleFromPage, normalizeDatabaseId, notionFetch } from './notion.service'
import { loadConfig } from './notion-poller.service'

const execFileAsync = promisify(execFile)

// One query for everything a desk card needs. `gh pr list --json commits`
// trips GitHub's node limit, so this asks for just the last commit, and only
// the newest reviews and comments (the auto-review verdict and the ticket bot
// comment are always recent).
const DESK_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title body isDraft url createdAt updatedAt headRefName baseRefName mergeable
        author { login }
        assignees(first: 10) { nodes { login } }
        reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
        labels(first: 20) { nodes { name color description } }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
        reviews(last: 50) { nodes { author { login } state submittedAt } }
        comments(last: 30) { totalCount nodes { author { login } body createdAt } }
      }
    }
  }
}`

interface RawDeskPR {
  number: number
  title: string
  body: string | null
  isDraft: boolean
  url: string
  createdAt: string
  updatedAt: string
  headRefName: string
  baseRefName: string
  mergeable: string | null
  author: { login: string } | null
  assignees: { nodes: Array<{ login: string }> }
  reviewRequests: { nodes: Array<{ requestedReviewer: { login?: string; name?: string } | null }> }
  labels: { nodes: Array<{ name: string; color: string; description?: string | null }> }
  commits: { nodes: Array<{ commit: { committedDate: string; statusCheckRollup: { state: string } | null } }> }
  reviews: { nodes: Array<{ author: { login: string } | null; state: string; submittedAt: string }> }
  comments: { totalCount: number; nodes: Array<{ author: { login: string } | null; body: string; createdAt: string }> }
}

function rollupToCI(state: string | null | undefined): CIStatus {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

function mergeableOf(v: string | null): DeskMergeable {
  const m = (v ?? '').toLowerCase()
  return m === 'mergeable' || m === 'conflicting' ? m : 'unknown'
}

export function mapDeskPR(raw: RawDeskPR): DeskPR {
  const lastCommit = raw.commits.nodes[0]?.commit ?? null
  const comments = raw.comments.nodes.map((c) => ({
    author: c.author?.login ?? '',
    body: c.body ?? '',
    createdAt: c.createdAt,
  }))
  const labels = raw.labels.nodes.map((l) => ({
    name: l.name,
    color: l.color,
    description: l.description ?? undefined,
  }))
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author?.login ?? '',
    isDraft: raw.isDraft,
    assignees: raw.assignees.nodes.map((a) => a.login).filter(Boolean),
    requestedReviewers: raw.reviewRequests.nodes
      .map((r) => r.requestedReviewer?.login || r.requestedReviewer?.name || '')
      .filter(Boolean),
    labels,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ciStatus: rollupToCI(lastCommit?.statusCheckRollup?.state),
    mergeable: mergeableOf(raw.mergeable),
    commentsCount: raw.comments.totalCount,
    review: deriveReviewState({
      comments,
      reviews: raw.reviews.nodes.map((r) => ({
        author: r.author?.login ?? '',
        state: r.state,
        submittedAt: r.submittedAt,
      })),
      lastCommitAt: lastCommit?.committedDate ?? null,
      labels: labels.map((l) => l.name),
    }),
    ticket: parseTicketRef(raw.title, raw.body ?? '', comments),
  }
}

/** The open PRs of the repo at `repoPath`, shaped for the desk. Throws on a gh failure. */
export async function listDeskPRs(repoPath: string): Promise<DeskPR[]> {
  const { owner, name } = await getRepoOwnerName(repoPath)
  const { stdout } = await execFileAsync(
    'gh',
    ['api', 'graphql', '-f', `query=${DESK_QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`],
    { cwd: repoPath, maxBuffer: 64 * 1024 * 1024 }
  )
  const parsed = JSON.parse(stdout) as {
    data?: { repository?: { pullRequests?: { nodes?: RawDeskPR[] } } }
  }
  return (parsed.data?.repository?.pullRequests?.nodes ?? []).map(mapDeskPR)
}

// ── Notion tickets ──────────────────────────────────────────────────────────

const TICKET_TTL_MS = 2 * 60_000
const SCHEMA_TTL_MS = 10 * 60_000

const ticketCache = new Map<string, { at: number; ticket: DeskTicket | null }>()
const schemaCache = new Map<string, { at: number; uniqueIdProp: string | null; prefix: string | null }>()

/** Test hook. */
export function clearDeskCaches(): void {
  ticketCache.clear()
  schemaCache.clear()
}

function dashed(id: string): string {
  const h = id.replace(/-/g, '')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

type NotionProp = { type?: string; [k: string]: unknown }

export function pageToDeskTicket(page: Record<string, unknown>): DeskTicket {
  const props = (page.properties ?? {}) as Record<string, NotionProp>
  let status: string | null = null
  let ticketId: string | null = null
  let assignees: string[] = []
  for (const prop of Object.values(props)) {
    if (!prop || typeof prop !== 'object') continue
    if (status == null && prop.type === 'status') {
      status = (prop.status as { name?: string } | null)?.name ?? null
    }
    if (ticketId == null && prop.type === 'unique_id') {
      const u = prop.unique_id as { prefix?: string | null; number?: number | null } | null
      if (u?.number != null) ticketId = u.prefix ? `${u.prefix}-${u.number}` : String(u.number)
    }
    if (assignees.length === 0 && prop.type === 'people') {
      const people = (prop.people as Array<{ name?: string }> | null) ?? []
      assignees = people.map((p) => p.name ?? '').filter(Boolean)
    }
  }
  return {
    pageId: String(page.id ?? '').replace(/-/g, ''),
    ticketId,
    title: extractTitleFromPage(page),
    status,
    url: String(page.url ?? ''),
    assignees,
  }
}

async function getTicketSchema(token: string, databaseId: string) {
  const id = normalizeDatabaseId(databaseId)
  const hit = schemaCache.get(id)
  if (hit && Date.now() - hit.at < SCHEMA_TTL_MS) return hit
  const db = (await notionFetch(token, `/databases/${id}`)) as {
    properties?: Record<string, { type?: string; unique_id?: { prefix?: string | null } }>
  }
  let uniqueIdProp: string | null = null
  let prefix: string | null = null
  for (const [name, prop] of Object.entries(db.properties ?? {})) {
    if (prop.type === 'unique_id') {
      uniqueIdProp = name
      prefix = prop.unique_id?.prefix ?? null
      break
    }
  }
  const entry = { at: Date.now(), uniqueIdProp, prefix }
  schemaCache.set(id, entry)
  return entry
}

async function fetchTicket(token: string, databaseId: string, ref: DeskTicketRef): Promise<DeskTicket | null> {
  if (ref.pageId) {
    const page = (await notionFetch(token, `/pages/${dashed(ref.pageId)}`)) as Record<string, unknown>
    return pageToDeskTicket(page)
  }
  if (!ref.ticketId) return null
  // A bare id like ENG-123 in a title: look it up by the database's unique ID,
  // and only when the prefix is the database's (so "UTF-8" never matches).
  const schema = await getTicketSchema(token, databaseId)
  if (!schema.uniqueIdProp) return null
  const m = /^([A-Z0-9]+)-(\d+)$/i.exec(ref.ticketId)
  if (!m) return null
  if (schema.prefix && schema.prefix.toUpperCase() !== m[1].toUpperCase()) return null
  const res = (await notionFetch(token, `/databases/${normalizeDatabaseId(databaseId)}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 1,
      filter: { property: schema.uniqueIdProp, unique_id: { equals: Number(m[2]) } },
    }),
  })) as { results?: Array<Record<string, unknown>> }
  const page = res.results?.[0]
  return page ? pageToDeskTicket(page) : null
}

/**
 * Resolves the given ticket refs with the project's Notion integration token.
 * Results are cached for a couple of minutes so the desk's poll doesn't hit
 * Notion for every card every time.
 */
export async function getDeskTickets(projectId: string, refs: DeskTicketRef[]): Promise<DeskTicketsResult> {
  const config = loadConfig(projectId)
  if (!config?.apiToken || !config.databaseId) return { configured: false, tickets: {} }
  const { apiToken, databaseId } = config

  const tickets: Record<string, DeskTicket> = {}
  let error: string | undefined
  const queue = refs.filter((r) => ticketKey(r) != null)
  const seen = new Set<string>()

  const worker = async () => {
    for (;;) {
      const ref = queue.shift()
      if (!ref) return
      const key = ticketKey(ref)!
      if (seen.has(key)) continue
      seen.add(key)
      const cached = ticketCache.get(key)
      if (cached && Date.now() - cached.at < TICKET_TTL_MS) {
        if (cached.ticket) tickets[key] = cached.ticket
        continue
      }
      try {
        const ticket = await fetchTicket(apiToken, databaseId, ref)
        ticketCache.set(key, { at: Date.now(), ticket })
        if (ticket) tickets[key] = ticket
      } catch (err) {
        // Remember the miss too, so a page the integration can't see isn't
        // re-requested on every poll.
        ticketCache.set(key, { at: Date.now(), ticket: null })
        error ??= err instanceof Error ? err.message : String(err)
      }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return { configured: true, tickets, ...(error ? { error } : {}) }
}

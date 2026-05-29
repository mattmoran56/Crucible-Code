import type {
  NotionDatabaseProperty,
  NotionDatabasePropertyOption,
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  NotionPropertyFilter,
  NotionPropertyUpdate,
  NotionRelationOption,
  NotionTaskPayload,
  NotionUser,
} from '../../shared/types'

// Returns the canonical list of filter groups for a config. Each group's
// conditions are ANDed; the groups themselves are ORed. Prefers the explicit
// `filterGroups` field; falls back to wrapping legacy `filters` as one group.
export function getEffectiveFilterGroups(
  config: Pick<NotionIntegrationConfig, 'filters' | 'filterGroups'>
): NotionPropertyFilter[][] {
  if (config.filterGroups && config.filterGroups.length > 0) {
    return config.filterGroups.filter((g) => g.length > 0)
  }
  return config.filters && config.filters.length > 0 ? [config.filters] : []
}

const NOTION_VERSION = '2022-06-28'
const NOTION_BASE = 'https://api.notion.com/v1'

interface NotionAPIError {
  status: number
  message: string
}

async function notionFetch(
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  const res = await fetch(`${NOTION_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await res.text()
  let parsed: unknown = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    // Non-JSON error body; keep raw text for the thrown message.
  }
  if (!res.ok) {
    const err: NotionAPIError = {
      status: res.status,
      message:
        (parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : body) || res.statusText,
    }
    throw new Error(`Notion API ${err.status}: ${err.message}`)
  }
  return parsed
}

export function normalizeDatabaseId(input: string): string {
  // Accept:
  //   - bare 32-char hex id (with or without dashes)
  //   - Notion URLs like https://www.notion.so/workspace/<title>-<32hex>?v=...
  // We find the last 32 hex chars in the string (ignoring dashes) and return them.
  const trimmed = input.trim().split('?')[0]
  const matches = trimmed.match(/[0-9a-fA-F]{32}/g)
  if (matches && matches.length > 0) return matches[matches.length - 1].toLowerCase()
  const stripped = trimmed.replace(/-/g, '')
  const tailMatch = stripped.match(/[0-9a-fA-F]{32}$/)
  if (tailMatch) return tailMatch[0].toLowerCase()
  return trimmed
}

type PlaceholderContext = {
  taskId?: string
  taskUrl?: string
  taskTitle?: string
  taskTitleSlug?: string
  branch?: string
  sessionId?: string
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function resolvePlaceholders(template: string, ctx: PlaceholderContext): string {
  const map: Record<string, string> = {
    '{{taskId}}': ctx.taskId ?? '',
    '{{taskUrl}}': ctx.taskUrl ?? '',
    '{{taskTitle}}': ctx.taskTitle ?? '',
    '{{taskTitleSlug}}': ctx.taskTitleSlug ?? (ctx.taskTitle ? slugify(ctx.taskTitle) : ''),
    '{{branch}}': ctx.branch ?? '',
    '{{sessionId}}': ctx.sessionId ?? '',
  }
  return template.replace(
    /\{\{(taskId|taskUrl|taskTitle|taskTitleSlug|branch|sessionId)\}\}/g,
    (m) => map[m] ?? ''
  )
}

export function valueReferencesSessionPlaceholder(value: string): boolean {
  return /\{\{(branch|sessionId)\}\}/.test(value)
}

// ── Filter translation ──────────────────────────────────────────────────────

function buildSingleFilter(f: NotionPropertyFilter): Record<string, unknown> | null {
  const base: Record<string, unknown> = { property: f.property }
  if (f.operator === 'is_empty' || f.operator === 'is_not_empty') {
    base[f.type] = { [f.operator]: true }
    return base
  }
  if (f.value === undefined || f.value === null || f.value === '') return null
  // Notion's relation filter only accepts contains/does_not_contain with a page id.
  // Translate equals → contains so the user can keep "equals" in the UI without
  // hitting a 400.
  if (f.type === 'relation') {
    const op =
      f.operator === 'equals' || f.operator === 'contains'
        ? 'contains'
        : f.operator === 'does_not_equal' || f.operator === 'does_not_contain'
          ? 'does_not_contain'
          : f.operator
    base.relation = { [op]: f.value }
    return base
  }
  // Formula / rollup filter: Notion expects
  //   `{ property, <kind>: { <resultType>: { <op>: value } } }`
  // where <kind> is 'formula' or 'rollup'. The result type is captured on the
  // filter when the user picked the property (via the sample-page lookup in
  // getDatabaseSchema, since GET /databases doesn't return it).
  if ((f.type === 'formula' || f.type === 'rollup') && f.formulaResultType) {
    const rt = f.formulaResultType
    let coerced: string | number | boolean = f.value as string | number | boolean
    if (rt === 'boolean') coerced = coerced === true || coerced === 'true' || coerced === '1'
    else if (rt === 'number') coerced = typeof coerced === 'number' ? coerced : Number(coerced)
    base[f.type] = { [rt]: { [f.operator]: coerced } }
    return base
  }
  // people only supports contains / does_not_contain — coerce equals.
  if (f.type === 'people') {
    const op =
      f.operator === 'equals' || f.operator === 'contains'
        ? 'contains'
        : f.operator === 'does_not_equal' || f.operator === 'does_not_contain'
          ? 'does_not_contain'
          : f.operator
    base.people = { [op]: f.value }
    return base
  }
  // multi_select doesn't support equals — coerce to contains.
  if (f.type === 'multi_select') {
    const op =
      f.operator === 'equals' || f.operator === 'contains'
        ? 'contains'
        : f.operator === 'does_not_equal' || f.operator === 'does_not_contain'
          ? 'does_not_contain'
          : f.operator
    base.multi_select = { [op]: f.value }
    return base
  }
  base[f.type] = { [f.operator]: f.value }
  return base
}

function buildFilterJson(filters: NotionPropertyFilter[]): Record<string, unknown> | undefined {
  const valid = filters.map(buildSingleFilter).filter((x): x is Record<string, unknown> => x !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return { and: valid }
}

// A sentinel indicating that a relation sub-filter resolved to zero matching
// pages — meaning the outer query should also return zero results without
// hitting the API.
const SHORT_CIRCUIT_EMPTY = Symbol('short-circuit-empty')

// Resolve any relation sub-filters into concrete `or`-of-relation.contains
// clauses by querying the related database first. Returns either:
//   - the symbol SHORT_CIRCUIT_EMPTY (no related pages matched → outer query
//     definitely has no results)
//   - an array of Notion filter clauses ready to be combined with `and`
async function materializeFilters(
  token: string,
  filters: NotionPropertyFilter[]
): Promise<Record<string, unknown>[] | typeof SHORT_CIRCUIT_EMPTY> {
  const out: Record<string, unknown>[] = []
  for (const f of filters) {
    if (f.type === 'relation' && f.subFilter && f.relationDatabaseId) {
      const inner = await materializeFilters(token, [f.subFilter])
      if (inner === SHORT_CIRCUIT_EMPTY) return SHORT_CIRCUIT_EMPTY
      const innerFilter =
        inner.length === 0 ? undefined : inner.length === 1 ? inner[0] : { and: inner }
      // Fetch matching pages in the related DB. Cap at 100 — if the user has
      // hundreds of matching related rows, the `or` group would balloon and
      // Notion would likely reject it; better to fail loudly than silently
      // truncate, so we throw if we hit the cap.
      const pages = await queryRawPages(token, f.relationDatabaseId, innerFilter, 100)
      if (pages.length === 0) return SHORT_CIRCUIT_EMPTY
      if (pages.length >= 100) {
        throw new Error(
          `Relation sub-filter on property "${f.property}" matched ≥100 related rows. Tighten the inner filter so the result set is smaller.`
        )
      }
      const orChildren = pages.map((p) => ({
        property: f.property,
        relation: { contains: p.id },
      }))
      if (orChildren.length === 1) out.push(orChildren[0])
      else out.push({ or: orChildren })
      continue
    }
    const j = buildSingleFilter(f)
    if (j) out.push(j)
  }
  return out
}

// Bare query helper that returns just `{ id }[]` for the related-DB lookup
// step. Doesn't paginate beyond `limit` — caller chooses the cap.
async function queryRawPages(
  token: string,
  databaseId: string,
  filter: Record<string, unknown> | undefined,
  limit: number
): Promise<{ id: string }[]> {
  const dbId = normalizeDatabaseId(databaseId)
  const body: Record<string, unknown> = { page_size: Math.min(100, limit) }
  if (filter) body.filter = filter
  const out: { id: string }[] = []
  let cursor: string | undefined
  while (out.length < limit) {
    if (cursor) body.start_cursor = cursor
    const res = (await notionFetch(token, `/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as { results: { id: string }[]; has_more?: boolean; next_cursor?: string | null }
    for (const r of res.results ?? []) {
      out.push({ id: r.id })
      if (out.length >= limit) break
    }
    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor
  }
  return out
}

// ── Page property extraction ────────────────────────────────────────────────

function extractTitleFromPage(
  page: Record<string, unknown>,
  titlePropertyName?: string
): string {
  const properties = (page.properties ?? {}) as Record<string, unknown>
  let titleProp: unknown = titlePropertyName ? properties[titlePropertyName] : undefined
  if (!titleProp) {
    for (const [, prop] of Object.entries(properties)) {
      if (
        prop &&
        typeof prop === 'object' &&
        (prop as Record<string, unknown>).type === 'title'
      ) {
        titleProp = prop
        break
      }
    }
  }
  if (!titleProp || typeof titleProp !== 'object') return ''
  const titleArr = (titleProp as Record<string, unknown>).title
  if (!Array.isArray(titleArr)) return ''
  return titleArr
    .map((seg) =>
      typeof seg === 'object' && seg && 'plain_text' in seg
        ? String((seg as { plain_text: unknown }).plain_text ?? '')
        : ''
    )
    .join('')
}

function pageToTaskPayload(
  page: Record<string, unknown>,
  titlePropertyName?: string
): NotionTaskPayload {
  return {
    id: String(page.id ?? ''),
    url: String(page.url ?? ''),
    title: extractTitleFromPage(page, titlePropertyName),
    rawProperties: (page.properties as Record<string, unknown>) ?? {},
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function queryDatabase(
  token: string,
  databaseId: string,
  groups: NotionPropertyFilter[][],
  titlePropertyName?: string
): Promise<NotionTaskPayload[]> {
  // Materialize each group independently (each may resolve relation
  // sub-filters). Drop any group that short-circuits to "no matches" — it
  // contributes nothing to the outer OR. If every group short-circuits (or
  // there were no groups), there's no filter at all → fetch everything.
  // If every *non-empty* group short-circuits but some groups existed, the
  // result is definitively empty.
  const filledGroups = groups.filter((g) => g.length > 0)
  let perGroup: Record<string, unknown>[] = []
  for (const g of filledGroups) {
    const materialized = await materializeFilters(token, g)
    if (materialized === SHORT_CIRCUIT_EMPTY) continue
    if (materialized.length === 0) continue
    perGroup.push(materialized.length === 1 ? materialized[0] : { and: materialized })
  }
  let filter: Record<string, unknown> | undefined
  if (filledGroups.length === 0) {
    filter = undefined
  } else if (perGroup.length === 0) {
    // Every group resolved to "no possible matches" via short-circuit.
    return []
  } else if (perGroup.length === 1) {
    filter = perGroup[0]
  } else {
    filter = { or: perGroup }
  }
  const dbId = normalizeDatabaseId(databaseId)
  const body: Record<string, unknown> = { page_size: 100 }
  if (filter) body.filter = filter
  // Paginate up to 5 pages (500 rows) — well past any reasonable poll batch.
  const out: NotionTaskPayload[] = []
  let cursor: string | undefined
  for (let i = 0; i < 5; i++) {
    if (cursor) body.start_cursor = cursor
    const res = (await notionFetch(token, `/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as { results: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null }
    for (const r of res.results ?? []) out.push(pageToTaskPayload(r, titlePropertyName))
    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor
  }
  return out
}

export async function getDatabaseSchema(
  token: string,
  databaseId: string
): Promise<NotionDatabaseSchema> {
  const dbId = normalizeDatabaseId(databaseId)
  const res = (await notionFetch(token, `/databases/${dbId}`)) as {
    id: string
    title?: Array<{ plain_text?: string }>
    properties: Record<string, {
      type: string
      select?: { options?: NotionDatabasePropertyOption[] }
      status?: { options?: NotionDatabasePropertyOption[] }
      multi_select?: { options?: NotionDatabasePropertyOption[] }
      relation?: { database_id?: string }
      formula?: { type?: 'boolean' | 'number' | 'date' | 'string' }
    }>
  }
  const titleText = (res.title ?? []).map((s) => s.plain_text ?? '').join('') || dbId
  let titlePropertyName = ''
  const properties: NotionDatabaseProperty[] = []
  for (const [name, prop] of Object.entries(res.properties ?? {})) {
    const type = prop.type
    if (type === 'title') titlePropertyName = name
    const options =
      type === 'select'
        ? prop.select?.options
        : type === 'status'
          ? prop.status?.options
          : type === 'multi_select'
            ? prop.multi_select?.options
            : undefined
    const relationDatabaseId = type === 'relation' ? prop.relation?.database_id : undefined
    const formulaResultType = type === 'formula' ? prop.formula?.type : undefined
    properties.push({ name, type, options, relationDatabaseId, formulaResultType })
  }
  // Notion's GET /databases endpoint no longer returns the result type for
  // formula (or rollup) properties — only the expression. The result type is
  // visible per-page when reading a property value. To populate
  // formulaResultType, we query a single page and look up each formula's
  // computed type. (We can't reliably know the result type without this — the
  // UI needs it to pick the right value input widget.)
  const needsSamplePage = properties.some(
    (p) => (p.type === 'formula' || p.type === 'rollup') && !p.formulaResultType
  )
  if (needsSamplePage) {
    try {
      const sample = (await notionFetch(token, `/databases/${dbId}/query`, {
        method: 'POST',
        body: JSON.stringify({ page_size: 1 }),
      })) as { results?: Array<{ properties?: Record<string, { type: string; formula?: { type?: string }; rollup?: { type?: string } }> }> }
      const samplePage = sample.results?.[0]
      const sampleProps = samplePage?.properties ?? {}
      for (const p of properties) {
        if (p.formulaResultType) continue
        const sp = sampleProps[p.name]
        if (!sp) continue
        if (p.type === 'formula' && sp.formula?.type) {
          p.formulaResultType = sp.formula.type as 'boolean' | 'number' | 'date' | 'string'
        } else if (p.type === 'rollup' && sp.rollup?.type) {
          // We reuse the same field for rollup — Notion's rollup result types
          // overlap with formula's enough that the UI / filter shape can
          // share the handling. ('array' isn't a primitive value type, so
          // those rollups still fall through to the free-text input.)
          const rt = sp.rollup.type
          if (rt === 'boolean' || rt === 'number' || rt === 'date') {
            p.formulaResultType = rt
          }
        }
      }
    } catch (err) {
      console.warn('[notion-schema] sample-page lookup for formula/rollup types failed', err)
    }
  }
  console.log(
    `[notion-schema] db=${dbId} title="${titleText}" properties=`,
    properties.map((p) => ({
      name: p.name,
      type: p.type,
      relationDatabaseId: p.relationDatabaseId,
      formulaResultType: p.formulaResultType,
    }))
  )
  return {
    id: res.id,
    title: titleText,
    titlePropertyName,
    properties,
  }
}

export async function listRelationOptions(
  token: string,
  databaseId: string
): Promise<NotionRelationOption[]> {
  const dbId = normalizeDatabaseId(databaseId)
  const out: NotionRelationOption[] = []
  let cursor: string | undefined
  const body: Record<string, unknown> = { page_size: 100 }
  for (let i = 0; i < 5; i++) {
    if (cursor) body.start_cursor = cursor
    else delete body.start_cursor
    const res = (await notionFetch(token, `/databases/${dbId}/query`, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as { results: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null }
    for (const r of res.results ?? []) {
      out.push({ id: String(r.id ?? ''), title: extractTitleFromPage(r) || String(r.id ?? '') })
    }
    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor
  }
  return out
}

export async function listUsers(token: string): Promise<NotionUser[]> {
  const out: NotionUser[] = []
  let cursor: string | undefined
  for (let i = 0; i < 10; i++) {
    const path = cursor ? `/users?start_cursor=${encodeURIComponent(cursor)}&page_size=100` : `/users?page_size=100`
    const res = (await notionFetch(token, path)) as {
      results: Array<{ id: string; type?: string; name?: string; avatar_url?: string }>
      has_more?: boolean
      next_cursor?: string | null
    }
    for (const u of res.results ?? []) {
      // Skip the workspace bot user — only show real people.
      if (u.type === 'bot') continue
      out.push({ id: u.id, name: u.name ?? u.id, avatarUrl: u.avatar_url })
    }
    if (!res.has_more || !res.next_cursor) break
    cursor = res.next_cursor
  }
  return out
}

// ── Property update translation ─────────────────────────────────────────────

function buildUpdateBody(update: NotionPropertyUpdate, ctx: PlaceholderContext): Record<string, unknown> {
  const resolved = resolvePlaceholders(update.value, ctx)
  switch (update.type) {
    case 'select':
      return { select: { name: resolved } }
    case 'status':
      return { status: { name: resolved } }
    case 'checkbox':
      return { checkbox: resolved === 'true' || resolved === '1' }
    case 'rich_text':
      return { rich_text: [{ type: 'text', text: { content: resolved } }] }
    case 'title':
      return { title: [{ type: 'text', text: { content: resolved } }] }
    case 'url':
      return { url: resolved || null }
    case 'number':
      return { number: resolved === '' ? null : Number(resolved) }
    case 'date':
      return { date: resolved ? { start: resolved } : null }
    case 'multi_select':
      return {
        multi_select: resolved
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      }
    default:
      // Fallback to rich_text — least lossy for unknown types.
      return { rich_text: [{ type: 'text', text: { content: resolved } }] }
  }
}

export async function updatePageProperties(
  token: string,
  pageId: string,
  updates: NotionPropertyUpdate[],
  ctx: PlaceholderContext
): Promise<void> {
  if (updates.length === 0) return
  const properties: Record<string, unknown> = {}
  for (const u of updates) properties[u.property] = buildUpdateBody(u, ctx)
  await notionFetch(token, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  })
}

export async function appendMarkdownBlocks(
  token: string,
  pageId: string,
  markdown: string,
  ctx: PlaceholderContext
): Promise<void> {
  const resolved = resolvePlaceholders(markdown, ctx).trim()
  if (!resolved) return
  // Lo-fi conversion: split on blank lines, one paragraph block per chunk.
  // Newlines inside a chunk become soft line breaks via separate rich_text segments.
  const chunks = resolved.split(/\n{2,}/)
  const children = chunks.map((chunk) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: chunk.split('\n').flatMap((line, i) =>
        i === 0
          ? [{ type: 'text', text: { content: line } }]
          : [
              { type: 'text', text: { content: '\n' + line } },
            ]
      ),
    },
  }))
  await notionFetch(token, `/blocks/${pageId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  })
}

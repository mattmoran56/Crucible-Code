import type {
  NotionDatabaseProperty,
  NotionDatabasePropertyOption,
  NotionDatabaseSchema,
  NotionPropertyFilter,
  NotionPropertyUpdate,
  NotionTaskPayload,
} from '../../shared/types'

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
  // Accept full Notion DB URLs and strip everything but the trailing 32-char id.
  // Notion URLs look like https://www.notion.so/workspace/<title>-<id> where id
  // is 32 hex chars without dashes. We accept dashed or undashed.
  const trimmed = input.trim()
  const noQuery = trimmed.split('?')[0]
  const tail = noQuery.split('/').pop() ?? noQuery
  const last = tail.split('-').pop() ?? tail
  return last
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
  if (f.value === undefined || f.value === null) return null
  base[f.type] = { [f.operator]: f.value }
  return base
}

function buildFilterJson(filters: NotionPropertyFilter[]): Record<string, unknown> | undefined {
  const valid = filters.map(buildSingleFilter).filter((x): x is Record<string, unknown> => x !== null)
  if (valid.length === 0) return undefined
  if (valid.length === 1) return valid[0]
  return { and: valid }
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
  filters: NotionPropertyFilter[],
  titlePropertyName?: string
): Promise<NotionTaskPayload[]> {
  const filter = buildFilterJson(filters)
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
    properties: Record<string, { type: string; select?: { options?: NotionDatabasePropertyOption[] }; status?: { options?: NotionDatabasePropertyOption[] }; multi_select?: { options?: NotionDatabasePropertyOption[] } }>
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
    properties.push({ name, type, options })
  }
  return {
    id: res.id,
    title: titleText,
    titlePropertyName,
    properties,
  }
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

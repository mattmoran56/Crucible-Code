import type { BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type {
  NotionFireTaskPayload,
  NotionIntegrationConfig,
  NotionPropertyUpdate,
  NotionTaskPayload,
} from '../../shared/types'
import { getStorePath } from '../store-path'
import {
  appendMarkdownBlocks,
  queryDatabase,
  resolvePlaceholders,
  slugify,
  updatePageProperties,
  valueReferencesSessionPlaceholder,
} from './notion.service'

const POLL_INTERVAL_MS = 5_000
const MAX_FIRES_PER_TICK = 5
const PICKED_UP_CAP = 1000

interface ConfigStoreShape {
  configByProject: Record<string, NotionIntegrationConfig>
}

interface PickedUpStoreShape {
  idsByProject: Record<string, string[]>
}

const configStore = new Store<ConfigStoreShape>({
  cwd: getStorePath(),
  name: 'notion-integration',
  defaults: { configByProject: {} },
})

const pickedUpStore = new Store<PickedUpStoreShape>({
  cwd: getStorePath(),
  name: 'notion-picked-up',
  defaults: { idsByProject: {} },
})

let pollTimer: ReturnType<typeof setInterval> | null = null
let mainWindow: BrowserWindow | null = null
// Per-project re-entrancy lock so a slow Notion query doesn't stack ticks.
const ticksInFlight = new Set<string>()

export const NOTION_CONFIG_FILE = 'notion-integration.json'

export function getConfigFilePath(): string {
  return `${getStorePath()}/${NOTION_CONFIG_FILE}`
}

export function loadAllConfigs(): Record<string, NotionIntegrationConfig> {
  // Re-read from disk on every call so the MCP-driven "edit the JSON
  // directly" path is picked up by the next tick without an app restart.
  // electron-store's get() reads from the cached in-memory copy, so we
  // bypass it for the poller path. We do this by re-instantiating —
  // electron-store re-reads from disk on construct.
  const fresh = new Store<ConfigStoreShape>({
    cwd: getStorePath(),
    name: 'notion-integration',
    defaults: { configByProject: {} },
  })
  return fresh.get('configByProject', {})
}

export function loadConfig(projectId: string): NotionIntegrationConfig | null {
  const all = loadAllConfigs()
  return all[projectId] ?? null
}

export function saveConfig(projectId: string, config: NotionIntegrationConfig): void {
  const all = configStore.get('configByProject', {})
  all[projectId] = config
  configStore.set('configByProject', all)
}

function getPickedUp(projectId: string): string[] {
  const all = pickedUpStore.get('idsByProject', {})
  return all[projectId] ?? []
}

function setPickedUp(projectId: string, ids: string[]): void {
  const all = pickedUpStore.get('idsByProject', {})
  // Keep only the newest PICKED_UP_CAP ids per project to bound growth.
  all[projectId] = ids.slice(-PICKED_UP_CAP)
  pickedUpStore.set('idsByProject', all)
}

function addPickedUp(projectId: string, ids: string[]): void {
  const existing = getPickedUp(projectId)
  const set = new Set(existing)
  for (const id of ids) set.add(id)
  setPickedUp(projectId, [...set])
}

export function clearPickedUp(projectId: string): void {
  const all = pickedUpStore.get('idsByProject', {})
  delete all[projectId]
  pickedUpStore.set('idsByProject', all)
}

export async function seedPickedUpCache(projectId: string): Promise<void> {
  const config = loadConfig(projectId)
  if (!config || !config.apiToken || !config.databaseId) return
  try {
    const pages = await queryDatabase(
      config.apiToken,
      config.databaseId,
      config.filters,
      config.titlePropertyName
    )
    addPickedUp(
      projectId,
      pages.map((p) => p.id)
    )
  } catch (err) {
    console.error('[notion-poller] seedPickedUpCache failed', err)
  }
}

function buildPlaceholderContext(page: NotionTaskPayload): {
  taskId: string
  taskUrl: string
  taskTitle: string
  taskTitleSlug: string
} {
  return {
    taskId: page.id,
    taskUrl: page.url,
    taskTitle: page.title,
    taskTitleSlug: slugify(page.title || page.id),
  }
}

function splitUpdates(
  updates: NotionPropertyUpdate[]
): { immediate: NotionPropertyUpdate[]; deferred: NotionPropertyUpdate[] } {
  const immediate: NotionPropertyUpdate[] = []
  const deferred: NotionPropertyUpdate[] = []
  for (const u of updates) {
    if (valueReferencesSessionPlaceholder(u.value)) deferred.push(u)
    else immediate.push(u)
  }
  return { immediate, deferred }
}

async function tickProject(projectId: string, config: NotionIntegrationConfig): Promise<void> {
  if (ticksInFlight.has(projectId)) return
  ticksInFlight.add(projectId)
  try {
    if (!config.enabled || !config.apiToken || !config.databaseId) return
    const pages = await queryDatabase(
      config.apiToken,
      config.databaseId,
      config.filters,
      config.titlePropertyName
    )
    const picked = new Set(getPickedUp(projectId))
    const candidates = pages.filter((p) => !picked.has(p.id))
    if (candidates.length === 0) return

    const window = mainWindow
    if (!window) return

    const batch = candidates.slice(0, MAX_FIRES_PER_TICK)
    for (const page of batch) {
      const ctx = buildPlaceholderContext(page)
      // Always add to the picked-up cache first so a failed immediate update
      // doesn't loop us forever — the user can clear-cache to retry.
      addPickedUp(projectId, [page.id])

      const { immediate } = splitUpdates(config.pickupUpdates)
      try {
        await updatePageProperties(config.apiToken, page.id, immediate, ctx)
      } catch (err) {
        console.error(`[notion-poller] immediate update failed for ${page.id}`, err)
        // Keep page in cache. Skip firing — we don't want to spawn a session
        // for a page we couldn't mark as in-progress (would race).
        continue
      }

      const branchTemplate = config.branchNameTemplate ?? 'notion/{{taskTitleSlug}}'
      const suggestedBranchName = resolvePlaceholders(branchTemplate, ctx) || `notion/${page.id.slice(0, 8)}`
      const suggestedSessionName = page.title ? slugify(page.title) || `notion-${page.id.slice(0, 8)}` : `notion-${page.id.slice(0, 8)}`
      const resolvedStartupPrompt = resolvePlaceholders(config.startupPromptTemplate, ctx)

      const payload: NotionFireTaskPayload = {
        projectId,
        page,
        resolvedStartupPrompt,
        suggestedBranchName,
        suggestedSessionName,
      }
      window.webContents.send(IPC.NOTION_FIRE_TASK, payload)
    }
  } catch (err) {
    console.error(`[notion-poller] tick failed for ${projectId}`, err)
  } finally {
    ticksInFlight.delete(projectId)
  }
}

async function tick(): Promise<void> {
  const all = loadAllConfigs()
  await Promise.all(
    Object.entries(all).map(([projectId, config]) => tickProject(projectId, config))
  )
}

export function startNotionPoller(window: BrowserWindow): void {
  mainWindow = window
  if (pollTimer) clearInterval(pollTimer)
  // Fire once on startup, then on the interval.
  void tick()
  pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS)
}

export function stopNotionPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  mainWindow = null
}

export async function applyWriteBack(
  projectId: string,
  page: NotionTaskPayload,
  branch: string,
  sessionId: string
): Promise<void> {
  const config = loadConfig(projectId)
  if (!config) return
  const ctx = {
    ...buildPlaceholderContext(page),
    branch,
    sessionId,
  }
  const { deferred } = splitUpdates(config.pickupUpdates)
  if (deferred.length > 0) {
    try {
      await updatePageProperties(config.apiToken, page.id, deferred, ctx)
    } catch (err) {
      console.error(`[notion-poller] write-back property update failed for ${page.id}`, err)
    }
  }
  if (config.pickupAppendMarkdown && config.pickupAppendMarkdown.trim()) {
    try {
      await appendMarkdownBlocks(config.apiToken, page.id, config.pickupAppendMarkdown, ctx)
    } catch (err) {
      console.error(`[notion-poller] append blocks failed for ${page.id}`, err)
    }
  }
}

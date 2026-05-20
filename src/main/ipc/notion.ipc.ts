import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type {
  NotionDatabaseSchema,
  NotionIntegrationConfig,
  NotionTaskPayload,
  NotionTestConnectionResult,
} from '../../shared/types'
import {
  applyWriteBack,
  clearPickedUp,
  getConfigFilePath,
  loadConfig,
  saveConfig,
  seedPickedUpCache,
  startNotionPoller,
  stopNotionPoller,
} from '../services/notion-poller.service'
import { getDatabaseSchema, queryDatabase } from '../services/notion.service'

export function registerNotionHandlers(window: BrowserWindow): void {
  startNotionPoller(window)

  ipcMain.handle(
    IPC.NOTION_CONFIG_LOAD,
    async (_e, projectId: string): Promise<NotionIntegrationConfig | null> => {
      return loadConfig(projectId)
    }
  )

  ipcMain.handle(
    IPC.NOTION_CONFIG_SAVE,
    async (
      _e,
      projectId: string,
      config: NotionIntegrationConfig,
      opts?: { backfill?: boolean }
    ): Promise<void> => {
      const previous = loadConfig(projectId)
      saveConfig(projectId, config)
      const flippedOn = !!config.enabled && !previous?.enabled
      if (flippedOn && !opts?.backfill) {
        // Seed the picked-up cache with whatever currently matches so we don't
        // spawn a session for every existing row in the user's backlog.
        await seedPickedUpCache(projectId)
      }
    }
  )

  ipcMain.handle(
    IPC.NOTION_TEST_CONNECTION,
    async (_e, token: string, databaseId: string): Promise<NotionTestConnectionResult> => {
      try {
        const pages = await queryDatabase(token, databaseId, [])
        return { ok: true, taskCount: pages.length }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(
    IPC.NOTION_GET_DATABASE_SCHEMA,
    async (_e, token: string, databaseId: string): Promise<NotionDatabaseSchema> => {
      return getDatabaseSchema(token, databaseId)
    }
  )

  ipcMain.handle(
    IPC.NOTION_APPLY_WRITE_BACK,
    async (
      _e,
      projectId: string,
      page: NotionTaskPayload,
      branch: string,
      sessionId: string
    ): Promise<void> => {
      await applyWriteBack(projectId, page, branch, sessionId)
    }
  )

  ipcMain.handle(IPC.NOTION_CLEAR_PICKED_UP, async (_e, projectId: string): Promise<void> => {
    clearPickedUp(projectId)
  })

  ipcMain.handle(IPC.NOTION_GET_CONFIG_PATH, async (): Promise<string> => {
    return getConfigFilePath()
  })
}

export function shutdownNotion(): void {
  stopNotionPoller()
}

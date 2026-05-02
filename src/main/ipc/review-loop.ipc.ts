import { BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type ReviewLoopConfig,
  type ReviewLoopProjectOverride,
  type ReviewLoopSettings,
  type ReviewLoopState,
} from '../../shared/types'
import { getStorePath } from '../store-path'
import {
  cancelReviewLoop,
  getReviewLoopState,
  setReviewLoopWindow,
  startReviewLoop,
  type StartReviewLoopOptions,
} from '../services/review-loop.service'

interface PersistedShape {
  workspace: ReviewLoopConfig
  projectOverrides: Record<string, ReviewLoopProjectOverride>
}

const store = new Store<PersistedShape>({
  name: 'review-loop',
  cwd: getStorePath(),
  defaults: {
    workspace: DEFAULT_REVIEW_LOOP_CONFIG,
    projectOverrides: {},
  },
})

export function registerReviewLoopHandlers(window: BrowserWindow): void {
  setReviewLoopWindow(window)

  ipcMain.handle(IPC.REVIEW_LOOP_SETTINGS_GET, async (): Promise<ReviewLoopSettings> => {
    return {
      workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, ...store.get('workspace') },
      projectOverrides: store.get('projectOverrides', {}),
    }
  })

  ipcMain.handle(
    IPC.REVIEW_LOOP_SETTINGS_SET,
    async (_e, settings: ReviewLoopSettings): Promise<void> => {
      store.set('workspace', { ...DEFAULT_REVIEW_LOOP_CONFIG, ...settings.workspace })
      store.set('projectOverrides', settings.projectOverrides ?? {})
    }
  )

  ipcMain.handle(
    IPC.REVIEW_LOOP_START,
    async (_e, opts: StartReviewLoopOptions): Promise<void> => {
      await startReviewLoop(opts)
    }
  )

  ipcMain.handle(IPC.REVIEW_LOOP_CANCEL, async (_e, sessionId: string): Promise<void> => {
    cancelReviewLoop(sessionId)
  })

  ipcMain.handle(
    IPC.REVIEW_LOOP_STATE_GET,
    async (_e, sessionId: string): Promise<ReviewLoopState | null> => {
      return getReviewLoopState(sessionId)
    }
  )
}

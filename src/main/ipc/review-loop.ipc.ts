import { BrowserWindow } from 'electron'
import { handle } from './handle'
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
import {
  cancelReviewLoopLite,
  getReviewLoopLiteState,
  hasReviewLoopLite,
  setReviewLoopLiteWindow,
  startReviewLoopLite,
} from '../services/review-loop-lite.service'

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
  setReviewLoopLiteWindow(window)

  handle(IPC.REVIEW_LOOP_SETTINGS_GET, async (): Promise<ReviewLoopSettings> => {
    return {
      workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, ...store.get('workspace') },
      projectOverrides: store.get('projectOverrides', {}),
    }
  })

  handle(
    IPC.REVIEW_LOOP_SETTINGS_SET,
    async (_e, settings: ReviewLoopSettings): Promise<void> => {
      store.set('workspace', { ...DEFAULT_REVIEW_LOOP_CONFIG, ...settings.workspace })
      store.set('projectOverrides', settings.projectOverrides ?? {})
    }
  )

  handle(
    IPC.REVIEW_LOOP_START,
    async (_e, opts: StartReviewLoopOptions): Promise<void> => {
      if (opts.config?.variant === 'pro') {
        await startReviewLoop(opts)
      } else {
        await startReviewLoopLite(opts)
      }
    }
  )

  handle(IPC.REVIEW_LOOP_CANCEL, async (_e, sessionId: string): Promise<void> => {
    // Cancel on whichever variant is running for this session.
    if (hasReviewLoopLite(sessionId)) cancelReviewLoopLite(sessionId)
    else cancelReviewLoop(sessionId)
  })

  handle(
    IPC.REVIEW_LOOP_STATE_GET,
    async (_e, sessionId: string): Promise<ReviewLoopState | null> => {
      return getReviewLoopLiteState(sessionId) ?? getReviewLoopState(sessionId)
    }
  )
}

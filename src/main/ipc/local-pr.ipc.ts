import type { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type {
  CreateLocalPRFromSessionInput,
  LocalPR,
  LocalPRUpdate,
} from '../../shared/types'
import * as localPr from '../services/local-pr.service'
import { promoteLocalPR } from '../services/local-pr-promote.service'
import { setLocalPRCapture } from '../services/notification-server'

export function registerLocalPRHandlers(window: BrowserWindow): void {
  localPr.startLocalPRService(window)

  // Wire the gh-shim capture endpoint to the local-PR store.
  setLocalPRCapture((args) => localPr.captureLocalPR(args))

  handle(IPC.LOCAL_PR_LIST, async (_e, projectId: string): Promise<LocalPR[]> => {
    return localPr.listLocalPRs(projectId)
  })

  handle(
    IPC.LOCAL_PR_CREATE,
    async (_e, input: CreateLocalPRFromSessionInput): Promise<LocalPR> => {
      return localPr.createFromSession(input)
    }
  )

  handle(
    IPC.LOCAL_PR_UPDATE,
    async (_e, id: string, update: LocalPRUpdate): Promise<LocalPR | null> => {
      return localPr.updateLocalPR(id, update)
    }
  )

  handle(IPC.LOCAL_PR_DISCARD, async (_e, id: string): Promise<void> => {
    localPr.discardLocalPR(id)
  })

  handle(IPC.LOCAL_PR_PROMOTE, async (_e, id: string): Promise<LocalPR | null> => {
    return promoteLocalPR(id)
  })

  handle(
    IPC.LOCAL_PR_SET_CAPTURE,
    async (_e, contextId: string, enabled: boolean): Promise<void> => {
      localPr.setCaptureContext(contextId, enabled ? {} : null)
    }
  )
}

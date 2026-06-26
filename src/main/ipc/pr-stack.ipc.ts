import type { BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { PRStack } from '../../shared/types'
import * as prStack from '../services/pr-stack.service'

export function registerPRStackHandlers(window: BrowserWindow): void {
  prStack.startPRStackService(window)

  handle(IPC.PR_STACK_LIST, async (_e, projectId: string): Promise<PRStack[]> => {
    return prStack.listStacks(projectId)
  })

  handle(
    IPC.PR_STACK_CREATE,
    async (_e, input: prStack.CreateStackInput): Promise<PRStack> => {
      return prStack.createStack(input)
    }
  )

  handle(IPC.PR_STACK_RENAME, async (_e, id: string, name: string): Promise<PRStack | null> => {
    return prStack.renameStack(id, name)
  })

  handle(IPC.PR_STACK_DELETE, async (_e, id: string): Promise<void> => {
    prStack.deleteStack(id)
  })

  handle(
    IPC.PR_STACK_ADD_ENTRY,
    async (_e, stackId: string, input: prStack.AddEntryInput): Promise<PRStack | null> => {
      return prStack.addEntry(stackId, input)
    }
  )

  handle(
    IPC.PR_STACK_REMOVE_ENTRY,
    async (_e, stackId: string, entryId: string): Promise<PRStack | null> => {
      return prStack.removeEntry(stackId, entryId)
    }
  )

  handle(
    IPC.PR_STACK_REORDER,
    async (_e, stackId: string, orderedEntryIds: string[]): Promise<PRStack | null> => {
      return prStack.reorderEntries(stackId, orderedEntryIds)
    }
  )

  handle(
    IPC.PR_STACK_MERGE,
    async (_e, targetId: string, sourceId: string): Promise<PRStack | null> => {
      return prStack.mergeStacks(targetId, sourceId)
    }
  )

  // Long-running: kick off and return immediately; progress streams via
  // PR_STACK_STATE_UPDATE (publish/propagation cursors on the stack).
  handle(IPC.PR_STACK_PUBLISH, async (_e, stackId: string): Promise<void> => {
    void prStack.publishStack(stackId)
  })

  handle(
    IPC.PR_STACK_PROPAGATE,
    async (_e, stackId: string, sourceEntryId: string): Promise<void> => {
      void prStack.propagateUpward(stackId, sourceEntryId)
    }
  )

  handle(
    IPC.PR_STACK_RESTACK,
    async (_e, stackId: string, mergedEntryId: string): Promise<void> => {
      void prStack.restackAfterMerge(stackId, mergedEntryId)
    }
  )
}

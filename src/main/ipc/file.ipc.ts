import { type BrowserWindow } from 'electron'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import {
  listDirectory,
  readFileContent,
  readFileBase64,
  writeFileContent,
  createFile,
  getFileStat,
  moveFile,
  watchDirectory,
  unwatchDirectory,
} from '../services/file.service'

/**
 * Which callers are watching each directory. Several windows can watch the same
 * worktree, so the watcher only closes once the last of them lets go (or its
 * window closes). Callers without a sender (the remote relay) share one slot.
 */
const watchRefs = new Map<string, Set<number | 'relay'>>()
const trackedSenders = new Set<number>()

function releaseWatch(dirPath: string, owner: number | 'relay'): void {
  const owners = watchRefs.get(dirPath)
  if (!owners) return
  owners.delete(owner)
  if (owners.size === 0) {
    watchRefs.delete(dirPath)
    unwatchDirectory(dirPath)
  }
}

export function registerFileHandlers(window: BrowserWindow) {
  handle(IPC.FILE_LIST_DIR, async (_e, dirPath: string) => {
    return listDirectory(dirPath)
  })

  handle(IPC.FILE_READ, async (_e, filePath: string, rootPath: string) => {
    return readFileContent(filePath, rootPath)
  })

  handle(IPC.FILE_WRITE, async (_e, filePath: string, content: string, rootPath: string) => {
    return writeFileContent(filePath, content, rootPath)
  })

  handle(IPC.FILE_CREATE, async (_e, filePath: string, rootPath: string) => {
    return createFile(filePath, rootPath)
  })

  handle(IPC.FILE_MOVE, async (_e, oldPath: string, newPath: string, rootPath: string) => {
    return moveFile(oldPath, newPath, rootPath)
  })

  handle(IPC.FILE_READ_BASE64, async (_e, filePath: string, rootPath: string) => {
    return readFileBase64(filePath, rootPath)
  })

  handle(IPC.FILE_STAT, async (_e, filePath: string) => {
    return getFileStat(filePath)
  })

  handle(IPC.FILE_WATCH, async (e, dirPath: string) => {
    const sender = e?.sender
    const owner = sender?.id ?? 'relay'
    if (!watchRefs.has(dirPath)) watchRefs.set(dirPath, new Set())
    watchRefs.get(dirPath)!.add(owner)
    if (sender && typeof owner === 'number' && !trackedSenders.has(owner)) {
      trackedSenders.add(owner)
      sender.once?.('destroyed', () => {
        trackedSenders.delete(owner)
        for (const dir of [...watchRefs.keys()]) releaseWatch(dir, owner)
      })
    }
    watchDirectory(dirPath, window)
  })

  handle(IPC.FILE_UNWATCH, async (e, dirPath: string) => {
    releaseWatch(dirPath, e?.sender?.id ?? 'relay')
  })
}

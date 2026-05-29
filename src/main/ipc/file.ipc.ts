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

  handle(IPC.FILE_WATCH, async (_e, dirPath: string) => {
    watchDirectory(dirPath, window)
  })

  handle(IPC.FILE_UNWATCH, async (_e, dirPath: string) => {
    unwatchDirectory(dirPath)
  })
}

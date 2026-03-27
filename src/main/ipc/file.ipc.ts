import { ipcMain, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import {
  listDirectory,
  readFileContent,
  writeFileContent,
  createFile,
  getFileStat,
  moveFile,
  watchDirectory,
  unwatchDirectory,
} from '../services/file.service'

export function registerFileHandlers(window: BrowserWindow) {
  ipcMain.handle(IPC.FILE_LIST_DIR, async (_e, dirPath: string) => {
    return listDirectory(dirPath)
  })

  ipcMain.handle(IPC.FILE_READ, async (_e, filePath: string, rootPath: string) => {
    return readFileContent(filePath, rootPath)
  })

  ipcMain.handle(IPC.FILE_WRITE, async (_e, filePath: string, content: string, rootPath: string) => {
    return writeFileContent(filePath, content, rootPath)
  })

  ipcMain.handle(IPC.FILE_CREATE, async (_e, filePath: string, rootPath: string) => {
    return createFile(filePath, rootPath)
  })

  ipcMain.handle(IPC.FILE_MOVE, async (_e, oldPath: string, newPath: string, rootPath: string) => {
    return moveFile(oldPath, newPath, rootPath)
  })

  ipcMain.handle(IPC.FILE_STAT, async (_e, filePath: string) => {
    return getFileStat(filePath)
  })

  ipcMain.handle(IPC.FILE_WATCH, async (_e, dirPath: string) => {
    watchDirectory(dirPath, window)
  })

  ipcMain.handle(IPC.FILE_UNWATCH, async (_e, dirPath: string) => {
    unwatchDirectory(dirPath)
  })
}

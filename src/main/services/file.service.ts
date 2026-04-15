import { readdir, readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { watch, type FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { FileEntry, FileStat } from '../../shared/types'

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.codecrucible-worktrees',
  '.DS_Store',
  'Thumbs.db',
])

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB hard limit

function validatePath(filePath: string, rootPath: string): void {
  const resolved = resolve(filePath)
  const resolvedRoot = resolve(rootPath)
  if (!resolved.startsWith(resolvedRoot)) {
    throw new Error(`Path is outside the repository root: ${filePath}`)
  }
}

export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((e) => !IGNORED_NAMES.has(e.name) && !e.name.startsWith('.git'))
    .map((e) => ({
      name: e.name,
      path: join(dirPath, e.name),
      isDirectory: e.isDirectory(),
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function readFileContent(filePath: string, rootPath: string): Promise<string> {
  validatePath(filePath, rootPath)
  const s = await stat(filePath)
  if (s.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(s.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`)
  }
  return readFile(filePath, 'utf-8')
}

export async function writeFileContent(filePath: string, content: string, rootPath: string): Promise<void> {
  validatePath(filePath, rootPath)
  await writeFile(filePath, content, 'utf-8')
}

export async function createFile(filePath: string, rootPath: string): Promise<void> {
  validatePath(filePath, rootPath)
  const dir = filePath.substring(0, filePath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, '', 'utf-8')
}

export async function moveFile(oldPath: string, newPath: string, rootPath: string): Promise<void> {
  validatePath(oldPath, rootPath)
  validatePath(newPath, rootPath)
  const dir = newPath.substring(0, newPath.lastIndexOf('/'))
  await mkdir(dir, { recursive: true })
  await rename(oldPath, newPath)
}

export async function readFileBase64(filePath: string, rootPath: string): Promise<string> {
  validatePath(filePath, rootPath)
  const s = await stat(filePath)
  if (s.size > MAX_FILE_SIZE) {
    throw new Error(`File is too large (${(s.size / 1024 / 1024).toFixed(1)}MB). Maximum is 5MB.`)
  }
  const buffer = await readFile(filePath)
  return buffer.toString('base64')
}

export async function getFileStat(filePath: string): Promise<FileStat> {
  try {
    const s = await stat(filePath)
    return { size: s.size, exists: true }
  } catch {
    return { size: 0, exists: false }
  }
}

// File watcher management
const watchers = new Map<string, FSWatcher>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const pendingChanges = new Set<string>()

export function watchDirectory(dirPath: string, window: BrowserWindow): void {
  if (watchers.has(dirPath)) return

  try {
    const watcher = watch(dirPath, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const fullPath = join(dirPath, filename)
      const name = filename.split('/').pop() ?? filename
      if (IGNORED_NAMES.has(name)) return

      pendingChanges.add(fullPath)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        for (const path of pendingChanges) {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC.FILE_CHANGED, path)
          }
        }
        pendingChanges.clear()
      }, 300)
    })

    watchers.set(dirPath, watcher)
  } catch {
    // fs.watch may not be available on all platforms
  }
}

export function unwatchDirectory(dirPath: string): void {
  const watcher = watchers.get(dirPath)
  if (watcher) {
    watcher.close()
    watchers.delete(dirPath)
  }
}

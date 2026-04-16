import { mkdirSync, writeFileSync, readFileSync, existsSync, watch } from 'node:fs'
import { join, basename } from 'node:path'
import type { FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'

interface Permissions {
  allow: string[]
  deny: string[]
}

// --- State ---

/** Active worktrees per project repo path */
const activeWorktrees = new Map<string, Set<string>>()

/** File watchers per worktree path */
const watchers = new Map<string, FSWatcher>()

/** Reverse lookup: worktree → repo path */
const repoLookup = new Map<string, string>()

/** Paths to skip in watcher callbacks (our own writes) */
const suppressSet = new Set<string>()

/** Debounce timers per worktree path */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** BrowserWindow ref for sending IPC events */
let mainWindow: BrowserWindow | null = null

// --- Public API ---

export function setWindow(window: BrowserWindow) {
  mainWindow = window
}

/**
 * Read canonical permissions from the main repo and merge them
 * into the worktree's settings.local.json.
 */
export function seedPermissions(repoPath: string, worktreePath: string): void {
  const canonical = readPermissions(repoPath)
  if (!canonical) return

  const worktreePerms = readPermissions(worktreePath) ?? { allow: [], deny: [] }
  const merged = mergePermissions(worktreePerms, canonical)
  writePermissions(worktreePath, merged)
}

/**
 * Register a worktree and start watching its settings file for permission changes.
 */
export function startWatching(repoPath: string, worktreePath: string): void {
  // Register in active set
  if (!activeWorktrees.has(repoPath)) {
    activeWorktrees.set(repoPath, new Set())
  }
  activeWorktrees.get(repoPath)!.add(worktreePath)
  repoLookup.set(worktreePath, repoPath)

  // Don't double-watch
  if (watchers.has(worktreePath)) return

  const claudeDir = join(worktreePath, '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  try {
    const watcher = watch(claudeDir, (eventType, filename) => {
      if (filename !== 'settings.local.json') return
      handleFileChange(worktreePath)
    })
    watchers.set(worktreePath, watcher)
  } catch {
    // Directory may not exist yet — that's fine, we'll catch changes on next spawn
  }
}

/**
 * Stop watching a worktree. Does a final sync to canonical before cleanup.
 */
export function stopWatching(worktreePath: string): void {
  const repoPath = repoLookup.get(worktreePath)

  // Final sync before cleanup
  if (repoPath) {
    syncToCanonical(worktreePath, repoPath)
  }

  // Close watcher
  const watcher = watchers.get(worktreePath)
  if (watcher) {
    watcher.close()
    watchers.delete(worktreePath)
  }

  // Clear debounce timer
  const timer = debounceTimers.get(worktreePath)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(worktreePath)
  }

  // Remove from active set
  if (repoPath) {
    const set = activeWorktrees.get(repoPath)
    if (set) {
      set.delete(worktreePath)
      if (set.size === 0) activeWorktrees.delete(repoPath)
    }
  }

  repoLookup.delete(worktreePath)
  suppressSet.delete(worktreePath)
}

/**
 * Stop all watchers and clear all timers (used on app quit).
 */
export function stopAllWatching(): void {
  for (const watcher of watchers.values()) {
    watcher.close()
  }
  watchers.clear()

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()

  activeWorktrees.clear()
  repoLookup.clear()
  suppressSet.clear()
}

/**
 * Read shared permissions from the canonical store (for UI panel).
 */
export function getSharedPermissions(repoPath: string): Permissions {
  return readPermissions(repoPath) ?? { allow: [], deny: [] }
}

/**
 * Update shared permissions from UI and propagate to all active worktrees.
 */
export function updateSharedPermissions(repoPath: string, permissions: Permissions): void {
  writePermissions(repoPath, permissions)

  // Propagate to all active worktrees
  const worktrees = activeWorktrees.get(repoPath)
  if (worktrees) {
    for (const wt of worktrees) {
      suppressSet.add(wt)
      const current = readPermissions(wt) ?? { allow: [], deny: [] }
      // For UI updates, replace rather than merge — the user is the authority
      writePermissions(wt, permissions)
    }
  }

  emitChanged(repoPath)
}

// --- Internal helpers ---

function handleFileChange(worktreePath: string): void {
  // Check suppress
  if (suppressSet.has(worktreePath)) {
    suppressSet.delete(worktreePath)
    return
  }

  // Debounce — Claude Code may write multiple times in quick succession
  const existing = debounceTimers.get(worktreePath)
  if (existing) clearTimeout(existing)

  debounceTimers.set(
    worktreePath,
    setTimeout(() => {
      debounceTimers.delete(worktreePath)
      processChange(worktreePath)
    }, 500)
  )
}

function processChange(worktreePath: string): void {
  const repoPath = repoLookup.get(worktreePath)
  if (!repoPath) return

  // Sync this worktree's permissions to canonical
  syncToCanonical(worktreePath, repoPath)

  // Read the now-updated canonical and propagate to other worktrees
  const canonical = readPermissions(repoPath)
  if (!canonical) return

  const worktrees = activeWorktrees.get(repoPath)
  if (worktrees) {
    for (const wt of worktrees) {
      if (wt === worktreePath) continue
      suppressSet.add(wt)
      const current = readPermissions(wt) ?? { allow: [], deny: [] }
      const merged = mergePermissions(current, canonical)
      writePermissions(wt, merged)
    }
  }

  emitChanged(repoPath)
}

function syncToCanonical(worktreePath: string, repoPath: string): void {
  const worktreePerms = readPermissions(worktreePath)
  if (!worktreePerms) return

  const canonical = readPermissions(repoPath) ?? { allow: [], deny: [] }
  const merged = mergePermissions(canonical, worktreePerms)
  writePermissions(repoPath, merged)
}

function emitChanged(repoPath: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const permissions = getSharedPermissions(repoPath)
    mainWindow.webContents.send(IPC.PERMISSIONS_CHANGED, repoPath, permissions)
  }
}

// --- File I/O ---

function readSettings(dirPath: string): Record<string, unknown> | null {
  const settingsPath = join(dirPath, '.claude', 'settings.local.json')
  try {
    if (!existsSync(settingsPath)) return null
    const raw = readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function readPermissions(dirPath: string): Permissions | null {
  const settings = readSettings(dirPath)
  if (!settings) return null

  const perms = settings.permissions as Record<string, unknown> | undefined
  if (!perms) return null

  return {
    allow: Array.isArray(perms.allow) ? perms.allow.filter((s): s is string => typeof s === 'string') : [],
    deny: Array.isArray(perms.deny) ? perms.deny.filter((s): s is string => typeof s === 'string') : [],
  }
}

function writePermissions(dirPath: string, permissions: Permissions): void {
  const claudeDir = join(dirPath, '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  const settingsPath = join(claudeDir, 'settings.local.json')

  // Read existing to preserve hooks/statusLine/etc
  let existing: Record<string, unknown> = {}
  try {
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf-8')
      existing = JSON.parse(raw)
    }
  } catch {
    // Ignore parse errors
  }

  existing.permissions = {
    allow: permissions.allow,
    deny: permissions.deny,
  }

  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n')
}

// --- Merge logic ---

export function mergePermissions(existing: Permissions, incoming: Permissions): Permissions {
  const allowSet = new Set([...existing.allow, ...incoming.allow])
  const denySet = new Set([...existing.deny, ...incoming.deny])

  // Deny wins over allow for conflicting entries
  for (const entry of denySet) {
    allowSet.delete(entry)
  }

  return {
    allow: [...allowSet].sort(),
    deny: [...denySet].sort(),
  }
}

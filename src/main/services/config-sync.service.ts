import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  watch,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { execSync } from 'node:child_process'
import type { FSWatcher } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { IPC } from '../../shared/constants'
import type { ConfigItem, ConfigItemType, ConfigTrackingMode } from '../../shared/types'

// --- Constants ---

const EXCLUDE_START = '# >>> CodeCrucible managed — do not edit >>>'
const EXCLUDE_END = '# <<< CodeCrucible managed <<<'
const CODECRUCIBLE_HOOK_PATTERN = /curl.*127\.0\.0\.1.*\/hook/

// --- State ---

/** Active worktrees per project repo path */
const activeWorktrees = new Map<string, Set<string>>()

/** File watchers per worktree path (watching .claude/ directory) */
const claudeWatchers = new Map<string, FSWatcher>()

/** File watchers for CLAUDE.md at repo root per worktree */
const claudeMdWatchers = new Map<string, FSWatcher>()

/** Reverse lookup: worktree → repo path */
const repoLookup = new Map<string, string>()

/** Paths to skip in watcher callbacks (our own writes) */
const suppressSet = new Set<string>()

/** Debounce timers per worktree path */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** BrowserWindow ref for sending IPC events */
let mainWindow: BrowserWindow | null = null

// --- Helpers ---

/**
 * Recursively find all .md files relative to `dir`.
 */
function walkMdFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      results.push(...walkMdFiles(join(dir, entry.name), rel))
    } else if (entry.name.endsWith('.md')) {
      results.push(rel)
    }
  }
  return results
}

/**
 * Recursively copy a directory of .md files, preserving subdirectory structure.
 */
function copyMdDir(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      if (!existsSync(destPath)) mkdirSync(destPath, { recursive: true })
      copyMdDir(srcPath, destPath)
    } else if (entry.name.endsWith('.md')) {
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
      copyFileSync(srcPath, destPath)
    }
  }
}

// --- Public API ---

export function setWindow(window: BrowserWindow) {
  mainWindow = window
}

/**
 * Get the canonical config directory for a project.
 * Located at: <repo-parent>/.codecrucible-worktrees/<repo-name>/.claude-config/
 */
export function getCanonicalDir(repoPath: string): string {
  const repoName = basename(repoPath)
  const dir = join(dirname(repoPath), '.codecrucible-worktrees', repoName, '.claude-config')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Discover all config items for a project by scanning the canonical directory.
 * On first call, seeds canonical from the main repo if empty.
 */
export function discoverConfigItems(repoPath: string): ConfigItem[] {
  const canonical = getCanonicalDir(repoPath)

  // Seed from main repo on first use
  initialSeedFromRepo(repoPath, canonical)

  const items: ConfigItem[] = []
  const excludedPaths = getExcludedPaths(repoPath)

  // Commands
  const commandsDir = join(canonical, 'commands')
  if (existsSync(commandsDir)) {
    for (const file of readdirSync(commandsDir)) {
      if (!file.endsWith('.md')) continue
      const name = file.replace(/\.md$/, '')
      const relativePath = `.claude/commands/${file}`
      items.push({
        id: `command:${name}`,
        type: 'command',
        name,
        relativePath,
        tracking: excludedPaths.has(relativePath) ? 'local' : 'shared',
      })
    }
  }

  // Skills (recursive scan)
  const skillsDir = join(canonical, 'skills')
  for (const relFile of walkMdFiles(skillsDir)) {
    const name = relFile.replace(/\.md$/, '')
    const relativePath = `.claude/skills/${relFile}`
    items.push({
      id: `skill:${name}`,
      type: 'skill',
      name,
      relativePath,
      tracking: excludedPaths.has(relativePath) ? 'local' : 'shared',
    })
  }

  // CLAUDE.md (root)
  if (existsSync(join(canonical, 'CLAUDE.md'))) {
    const relativePath = 'CLAUDE.md'
    items.push({
      id: 'claudemd:root',
      type: 'claudemd',
      name: 'CLAUDE.md',
      relativePath,
      tracking: excludedPaths.has(relativePath) ? 'local' : 'shared',
    })
  }

  // .claude/CLAUDE.md
  if (existsSync(join(canonical, '.claude-CLAUDE.md'))) {
    const relativePath = '.claude/CLAUDE.md'
    items.push({
      id: 'claudemd:.claude',
      type: 'claudemd',
      name: '.claude/CLAUDE.md',
      relativePath,
      tracking: excludedPaths.has(relativePath) ? 'local' : 'shared',
    })
  }

  // User hooks from settings.local.json (scan canonical or first active worktree)
  const userHooks = discoverUserHooks(repoPath)
  for (const hook of userHooks) {
    items.push(hook)
  }

  return items
}

/**
 * Get the content of a config item.
 */
export function getConfigContent(repoPath: string, itemId: string): string | null {
  const canonical = getCanonicalDir(repoPath)
  const filePath = canonicalPathForItem(canonical, itemId)
  if (!filePath || !existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
}

/**
 * Update the content of a config item and sync to worktrees.
 */
export function updateConfigContent(repoPath: string, itemId: string, content: string): void {
  const canonical = getCanonicalDir(repoPath)
  const filePath = canonicalPathForItem(canonical, itemId)
  if (!filePath) return

  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content)

  // Sync to all active worktrees
  broadcastToWorktrees(repoPath)
  emitChanged(repoPath)
}

/**
 * Toggle git tracking for a config item.
 */
export function setTracking(repoPath: string, itemId: string, mode: ConfigTrackingMode): void {
  // Tracking toggle only applies to the main repo, not worktrees
  // (worktrees always have config files excluded)
  const items = discoverConfigItems(repoPath)
  const item = items.find((i) => i.id === itemId)
  if (!item) return

  const excludePath = getGitExcludePath(repoPath)
  if (!excludePath) return

  updateExcludeFile(excludePath, item.relativePath, mode)
  emitChanged(repoPath)
}

/**
 * Create a new command file, sync to worktrees, and add to git exclude.
 */
export function createCommand(repoPath: string, name: string, content: string): ConfigItem {
  const canonical = getCanonicalDir(repoPath)
  const commandsDir = join(canonical, 'commands')
  if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true })

  const filename = `${name}.md`
  writeFileSync(join(commandsDir, filename), content)

  const relativePath = `.claude/commands/${filename}`

  // Add to git exclude (local by default)
  const excludePath = getGitExcludePath(repoPath)
  if (excludePath) {
    updateExcludeFile(excludePath, relativePath, 'local')
  }

  // Sync to all active worktrees
  broadcastToWorktrees(repoPath)
  emitChanged(repoPath)

  return {
    id: `command:${name}`,
    type: 'command',
    name,
    relativePath,
    tracking: 'local',
  }
}

/**
 * Create a CLAUDE.md file (root or .claude/), sync to worktrees, and add to git exclude.
 */
export function createClaudeMd(repoPath: string, location: 'root' | '.claude', content: string): ConfigItem {
  const canonical = getCanonicalDir(repoPath)

  if (location === 'root') {
    writeFileSync(join(canonical, 'CLAUDE.md'), content)
    const relativePath = 'CLAUDE.md'

    const excludePath = getGitExcludePath(repoPath)
    if (excludePath) updateExcludeFile(excludePath, relativePath, 'local')

    broadcastToWorktrees(repoPath)
    emitChanged(repoPath)

    return { id: 'claudemd:root', type: 'claudemd', name: 'CLAUDE.md', relativePath, tracking: 'local' }
  } else {
    writeFileSync(join(canonical, '.claude-CLAUDE.md'), content)
    const relativePath = '.claude/CLAUDE.md'

    const excludePath = getGitExcludePath(repoPath)
    if (excludePath) updateExcludeFile(excludePath, relativePath, 'local')

    broadcastToWorktrees(repoPath)
    emitChanged(repoPath)

    return { id: 'claudemd:.claude', type: 'claudemd', name: '.claude/CLAUDE.md', relativePath, tracking: 'local' }
  }
}

/**
 * Delete a config item from canonical and all worktrees.
 */
export function deleteConfigItem(repoPath: string, itemId: string): void {
  const canonical = getCanonicalDir(repoPath)
  const filePath = canonicalPathForItem(canonical, itemId)
  if (filePath && existsSync(filePath)) {
    unlinkSync(filePath)
  }

  // Find the relative path to remove from exclude
  const items = discoverConfigItems(repoPath)
  const item = items.find((i) => i.id === itemId)

  // Remove from exclude file
  if (item) {
    const excludePath = getGitExcludePath(repoPath)
    if (excludePath) {
      removeFromExcludeFile(excludePath, item.relativePath)
    }
  }

  // Delete from all active worktrees
  const worktrees = activeWorktrees.get(repoPath)
  if (worktrees) {
    for (const wt of worktrees) {
      const wtFilePath = worktreePathForItem(wt, itemId)
      if (wtFilePath && existsSync(wtFilePath)) {
        suppressSet.add(wt)
        unlinkSync(wtFilePath)
      }
    }
  }

  emitChanged(repoPath)
}

/**
 * Copy canonical config files into a worktree. Called on terminal spawn.
 */
export function syncConfigToWorktree(repoPath: string, worktreePath: string): void {
  const canonical = getCanonicalDir(repoPath)

  // Seed from repo first time
  initialSeedFromRepo(repoPath, canonical)

  // Copy commands
  const commandsDir = join(canonical, 'commands')
  if (existsSync(commandsDir)) {
    const wtCommandsDir = join(worktreePath, '.claude', 'commands')
    if (!existsSync(wtCommandsDir)) mkdirSync(wtCommandsDir, { recursive: true })

    for (const file of readdirSync(commandsDir)) {
      if (!file.endsWith('.md')) continue
      suppressSet.add(worktreePath)
      copyFileSync(join(commandsDir, file), join(wtCommandsDir, file))
    }
  }

  // Copy skills (recursive)
  const skillsDir = join(canonical, 'skills')
  if (existsSync(skillsDir)) {
    const wtSkillsDir = join(worktreePath, '.claude', 'skills')
    suppressSet.add(worktreePath)
    copyMdDir(skillsDir, wtSkillsDir)
  }

  // Copy CLAUDE.md (root)
  if (existsSync(join(canonical, 'CLAUDE.md'))) {
    suppressSet.add(worktreePath)
    copyFileSync(join(canonical, 'CLAUDE.md'), join(worktreePath, 'CLAUDE.md'))
  }

  // Copy .claude/CLAUDE.md
  if (existsSync(join(canonical, '.claude-CLAUDE.md'))) {
    const claudeDir = join(worktreePath, '.claude')
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })
    suppressSet.add(worktreePath)
    copyFileSync(join(canonical, '.claude-CLAUDE.md'), join(claudeDir, 'CLAUDE.md'))
  }

  // Ensure all config files are git-excluded in worktrees
  excludeAllConfigInWorktree(repoPath, worktreePath)
}

/**
 * Register a worktree and start watching for config changes.
 */
export function startWatching(repoPath: string, worktreePath: string): void {
  // Register in active set
  if (!activeWorktrees.has(repoPath)) {
    activeWorktrees.set(repoPath, new Set())
  }
  activeWorktrees.get(repoPath)!.add(worktreePath)
  repoLookup.set(worktreePath, repoPath)

  // Don't double-watch
  if (claudeWatchers.has(worktreePath)) return

  // Watch .claude/ directory
  const claudeDir = join(worktreePath, '.claude')
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })

  try {
    const watcher = watch(claudeDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      // Only care about commands, skills, and CLAUDE.md changes
      if (filename.startsWith('commands/') || filename.startsWith('skills/') || filename === 'CLAUDE.md') {
        handleFileChange(worktreePath)
      }
    })
    claudeWatchers.set(worktreePath, watcher)
  } catch {
    // Directory may not exist yet
  }

  // Watch CLAUDE.md at worktree root
  const claudeMdPath = join(worktreePath, 'CLAUDE.md')
  try {
    if (existsSync(claudeMdPath)) {
      const watcher = watch(claudeMdPath, () => {
        handleFileChange(worktreePath)
      })
      claudeMdWatchers.set(worktreePath, watcher)
    }
  } catch {
    // File may not exist yet
  }
}

/**
 * Stop watching a worktree and clean up.
 */
export function stopWatching(worktreePath: string): void {
  const repoPath = repoLookup.get(worktreePath)

  // Close watchers
  const claudeWatcher = claudeWatchers.get(worktreePath)
  if (claudeWatcher) {
    claudeWatcher.close()
    claudeWatchers.delete(worktreePath)
  }

  const mdWatcher = claudeMdWatchers.get(worktreePath)
  if (mdWatcher) {
    mdWatcher.close()
    claudeMdWatchers.delete(worktreePath)
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
  for (const watcher of claudeWatchers.values()) {
    watcher.close()
  }
  claudeWatchers.clear()

  for (const watcher of claudeMdWatchers.values()) {
    watcher.close()
  }
  claudeMdWatchers.clear()

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()

  activeWorktrees.clear()
  repoLookup.clear()
  suppressSet.clear()
}

// --- Internal helpers ---

/**
 * Seeds the canonical directory from the main repo if it's empty.
 */
function initialSeedFromRepo(repoPath: string, canonical: string): void {
  // Check if canonical already has content
  const commandsDir = join(canonical, 'commands')
  const skillsDir = join(canonical, 'skills')
  const hasCommands = existsSync(commandsDir) && readdirSync(commandsDir).some((f) => f.endsWith('.md'))
  const hasSkills = existsSync(skillsDir) && walkMdFiles(skillsDir).length > 0
  const hasClaudeMd = existsSync(join(canonical, 'CLAUDE.md'))
  const hasClaudeClaudeMd = existsSync(join(canonical, '.claude-CLAUDE.md'))

  if (hasCommands || hasSkills || hasClaudeMd || hasClaudeClaudeMd) return

  // Seed from main repo
  const repoCommandsDir = join(repoPath, '.claude', 'commands')
  if (existsSync(repoCommandsDir)) {
    if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true })
    for (const file of readdirSync(repoCommandsDir)) {
      if (!file.endsWith('.md')) continue
      copyFileSync(join(repoCommandsDir, file), join(commandsDir, file))
    }
  }

  // Seed skills (recursive)
  const repoSkillsDir = join(repoPath, '.claude', 'skills')
  if (existsSync(repoSkillsDir)) {
    copyMdDir(repoSkillsDir, skillsDir)
  }

  if (existsSync(join(repoPath, 'CLAUDE.md'))) {
    copyFileSync(join(repoPath, 'CLAUDE.md'), join(canonical, 'CLAUDE.md'))
  }

  if (existsSync(join(repoPath, '.claude', 'CLAUDE.md'))) {
    copyFileSync(join(repoPath, '.claude', 'CLAUDE.md'), join(canonical, '.claude-CLAUDE.md'))
  }
}

function handleFileChange(worktreePath: string): void {
  if (suppressSet.has(worktreePath)) {
    suppressSet.delete(worktreePath)
    return
  }

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

  const canonical = getCanonicalDir(repoPath)

  // Adopt genuinely NEW files (exist in worktree but not canonical)
  const adopted = adoptNewFiles(worktreePath, canonical)

  // Restore canonical state to worktree (revert modifications/deletions)
  suppressSet.add(worktreePath)
  copyCanonicalToWorktree(canonical, worktreePath)

  // If new files were adopted, broadcast to other worktrees and update exclude
  if (adopted) {
    const worktrees = activeWorktrees.get(repoPath)
    if (worktrees) {
      for (const wt of worktrees) {
        if (wt === worktreePath) continue
        suppressSet.add(wt)
        copyCanonicalToWorktree(canonical, wt)
        excludeAllConfigInWorktree(repoPath, wt)
      }
    }
    // Also exclude new files in the originating worktree
    excludeAllConfigInWorktree(repoPath, worktreePath)
  }

  emitChanged(repoPath)
}

function copyCanonicalToWorktree(canonical: string, worktreePath: string): void {
  // Copy commands
  const commandsDir = join(canonical, 'commands')
  if (existsSync(commandsDir)) {
    const wtCommandsDir = join(worktreePath, '.claude', 'commands')
    if (!existsSync(wtCommandsDir)) mkdirSync(wtCommandsDir, { recursive: true })

    for (const file of readdirSync(commandsDir)) {
      if (!file.endsWith('.md')) continue
      copyFileSync(join(commandsDir, file), join(wtCommandsDir, file))
    }
  }

  // Copy skills (recursive)
  const skillsDir = join(canonical, 'skills')
  if (existsSync(skillsDir)) {
    const wtSkillsDir = join(worktreePath, '.claude', 'skills')
    copyMdDir(skillsDir, wtSkillsDir)
  }

  // Copy CLAUDE.md (root)
  if (existsSync(join(canonical, 'CLAUDE.md'))) {
    copyFileSync(join(canonical, 'CLAUDE.md'), join(worktreePath, 'CLAUDE.md'))
  }

  // Copy .claude/CLAUDE.md
  if (existsSync(join(canonical, '.claude-CLAUDE.md'))) {
    const claudeDir = join(worktreePath, '.claude')
    if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true })
    copyFileSync(join(canonical, '.claude-CLAUDE.md'), join(claudeDir, 'CLAUDE.md'))
  }
}

function broadcastToWorktrees(repoPath: string): void {
  const worktrees = activeWorktrees.get(repoPath)
  if (!worktrees) return

  const canonical = getCanonicalDir(repoPath)
  for (const wt of worktrees) {
    suppressSet.add(wt)
    copyCanonicalToWorktree(canonical, wt)
  }
}

/**
 * Map an item ID to its path in the canonical directory.
 */
function canonicalPathForItem(canonical: string, itemId: string): string | null {
  if (itemId.startsWith('command:')) {
    const name = itemId.slice('command:'.length)
    return join(canonical, 'commands', `${name}.md`)
  }
  if (itemId.startsWith('skill:')) {
    const name = itemId.slice('skill:'.length)
    return join(canonical, 'skills', `${name}.md`)
  }
  if (itemId === 'claudemd:root') {
    return join(canonical, 'CLAUDE.md')
  }
  if (itemId === 'claudemd:.claude') {
    return join(canonical, '.claude-CLAUDE.md')
  }
  return null
}

/**
 * Map an item ID to its path in a worktree.
 */
function worktreePathForItem(worktreePath: string, itemId: string): string | null {
  if (itemId.startsWith('command:')) {
    const name = itemId.slice('command:'.length)
    return join(worktreePath, '.claude', 'commands', `${name}.md`)
  }
  if (itemId.startsWith('skill:')) {
    const name = itemId.slice('skill:'.length)
    return join(worktreePath, '.claude', 'skills', `${name}.md`)
  }
  if (itemId === 'claudemd:root') {
    return join(worktreePath, 'CLAUDE.md')
  }
  if (itemId === 'claudemd:.claude') {
    return join(worktreePath, '.claude', 'CLAUDE.md')
  }
  return null
}

/**
 * Adopt new .md files from a worktree into canonical.
 * Only copies files that do NOT exist in canonical (new creations).
 * Returns true if any files were adopted.
 */
function adoptNewFiles(worktreePath: string, canonical: string): boolean {
  let adopted = false

  // Check commands
  const wtCommandsDir = join(worktreePath, '.claude', 'commands')
  const canonicalCommandsDir = join(canonical, 'commands')
  if (existsSync(wtCommandsDir)) {
    for (const file of readdirSync(wtCommandsDir)) {
      if (!file.endsWith('.md')) continue
      const canonicalPath = join(canonicalCommandsDir, file)
      if (!existsSync(canonicalPath)) {
        if (!existsSync(canonicalCommandsDir)) mkdirSync(canonicalCommandsDir, { recursive: true })
        copyFileSync(join(wtCommandsDir, file), canonicalPath)
        adopted = true
      }
    }
  }

  // Check skills (recursive)
  const wtSkillsDir = join(worktreePath, '.claude', 'skills')
  const canonicalSkillsDir = join(canonical, 'skills')
  if (existsSync(wtSkillsDir)) {
    for (const relFile of walkMdFiles(wtSkillsDir)) {
      const canonicalPath = join(canonicalSkillsDir, relFile)
      if (!existsSync(canonicalPath)) {
        const dir = dirname(canonicalPath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        copyFileSync(join(wtSkillsDir, relFile), canonicalPath)
        adopted = true
      }
    }
  }

  return adopted
}

/**
 * Check if a path is a worktree (not the main repo).
 */
function isWorktree(worktreePath: string): boolean {
  return worktreePath.includes('.codecrucible-worktrees')
}

/**
 * Ensure all config files are git-excluded in a worktree.
 * Worktrees always have config files excluded from git.
 */
function excludeAllConfigInWorktree(repoPath: string, worktreePath: string): void {
  if (!isWorktree(worktreePath)) return

  // Get the worktree-specific git exclude path
  // Worktrees have their own .git directory (or a .git file pointing to the main repo)
  let excludePath: string | null = null
  try {
    const gitDir = execSync('git rev-parse --git-dir', {
      cwd: worktreePath,
      encoding: 'utf-8',
    }).trim()

    const absGitDir = gitDir.startsWith('/')
      ? gitDir
      : join(worktreePath, gitDir)

    const infoDir = join(absGitDir, 'info')
    if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true })
    excludePath = join(infoDir, 'exclude')
  } catch {
    return
  }

  if (!excludePath) return

  // Collect all config file paths that should be excluded
  const canonical = getCanonicalDir(repoPath)
  const pathsToExclude = new Set<string>()

  // Commands
  const commandsDir = join(canonical, 'commands')
  if (existsSync(commandsDir)) {
    for (const file of readdirSync(commandsDir)) {
      if (!file.endsWith('.md')) continue
      pathsToExclude.add(`.claude/commands/${file}`)
    }
  }

  // Skills
  for (const relFile of walkMdFiles(join(canonical, 'skills'))) {
    pathsToExclude.add(`.claude/skills/${relFile}`)
  }

  // CLAUDE.md files
  if (existsSync(join(canonical, 'CLAUDE.md'))) {
    pathsToExclude.add('CLAUDE.md')
  }
  if (existsSync(join(canonical, '.claude-CLAUDE.md'))) {
    pathsToExclude.add('.claude/CLAUDE.md')
  }

  // Ensure all paths are in the managed exclude section
  for (const p of pathsToExclude) {
    updateExcludeFile(excludePath, p, 'local')
  }
}

// --- Git exclude management ---

function getGitExcludePath(repoPath: string): string | null {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim()

    // git-common-dir may be relative to cwd
    const absGitDir = gitCommonDir.startsWith('/')
      ? gitCommonDir
      : join(repoPath, gitCommonDir)

    const infoDir = join(absGitDir, 'info')
    if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true })

    return join(infoDir, 'exclude')
  } catch {
    return null
  }
}

/**
 * Read the set of paths in our managed section of the exclude file.
 */
function getExcludedPaths(repoPath: string): Set<string> {
  const excludePath = getGitExcludePath(repoPath)
  if (!excludePath || !existsSync(excludePath)) return new Set()

  const content = readFileSync(excludePath, 'utf-8')
  const lines = content.split('\n')

  const paths = new Set<string>()
  let inSection = false

  for (const line of lines) {
    if (line === EXCLUDE_START) {
      inSection = true
      continue
    }
    if (line === EXCLUDE_END) {
      inSection = false
      continue
    }
    if (inSection && line.trim() && !line.startsWith('#')) {
      paths.add(line.trim())
    }
  }

  return paths
}

/**
 * Add or remove a path from the managed section of the exclude file.
 */
function updateExcludeFile(excludePath: string, relativePath: string, mode: ConfigTrackingMode): void {
  let content = ''
  if (existsSync(excludePath)) {
    content = readFileSync(excludePath, 'utf-8')
  }

  // Parse the managed section
  const lines = content.split('\n')
  const before: string[] = []
  const managed: string[] = []
  const after: string[] = []

  let section: 'before' | 'managed' | 'after' = 'before'

  for (const line of lines) {
    if (line === EXCLUDE_START) {
      section = 'managed'
      continue
    }
    if (line === EXCLUDE_END) {
      section = 'after'
      continue
    }
    if (section === 'before') before.push(line)
    else if (section === 'managed') managed.push(line)
    else after.push(line)
  }

  // Update the managed list
  const pathSet = new Set(managed.filter((l) => l.trim() && !l.startsWith('#')))

  if (mode === 'local') {
    pathSet.add(relativePath)
  } else {
    pathSet.delete(relativePath)
  }

  // Rebuild the file
  const sortedPaths = [...pathSet].sort()
  const newContent = [
    ...before,
    EXCLUDE_START,
    ...sortedPaths,
    EXCLUDE_END,
    ...after,
  ].join('\n')

  writeFileSync(excludePath, newContent)
}

/**
 * Remove a path from the managed section (e.g. on item deletion).
 */
function removeFromExcludeFile(excludePath: string, relativePath: string): void {
  if (!existsSync(excludePath)) return
  updateExcludeFile(excludePath, relativePath, 'shared')
}

// --- Hook discovery ---

/**
 * Discover user-defined hooks (non-CodeCrucible) from the first available source.
 */
function discoverUserHooks(repoPath: string): ConfigItem[] {
  // Try to read from any active worktree's settings.local.json
  const worktrees = activeWorktrees.get(repoPath)
  let settingsPath: string | null = null

  if (worktrees) {
    for (const wt of worktrees) {
      const candidate = join(wt, '.claude', 'settings.local.json')
      if (existsSync(candidate)) {
        settingsPath = candidate
        break
      }
    }
  }

  // Fall back to main repo
  if (!settingsPath) {
    const candidate = join(repoPath, '.claude', 'settings.local.json')
    if (existsSync(candidate)) {
      settingsPath = candidate
    }
  }

  if (!settingsPath) return []

  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const settings = JSON.parse(raw)
    const hooks = settings.hooks as Record<string, unknown[]> | undefined
    if (!hooks) return []

    const items: ConfigItem[] = []
    let hookIndex = 0

    for (const [eventType, matcherEntries] of Object.entries(hooks)) {
      if (!Array.isArray(matcherEntries)) continue

      for (const entry of matcherEntries) {
        const e = entry as { matcher?: string; hooks?: Array<{ command?: string }> }
        if (!e.hooks || !Array.isArray(e.hooks)) continue

        // Check if ANY hook in this entry is a CodeCrucible hook
        const isCodeCrucible = e.hooks.some(
          (h) => typeof h.command === 'string' && CODECRUCIBLE_HOOK_PATTERN.test(h.command)
        )

        if (!isCodeCrucible) {
          const matcher = e.matcher || '*'
          items.push({
            id: `hook:${eventType}:${hookIndex}`,
            type: 'hook',
            name: `${eventType} (${matcher})`,
            relativePath: '.claude/settings.local.json',
            tracking: 'local', // Hooks in settings.local.json are always local
          })
        }
        hookIndex++
      }
    }

    return items
  } catch {
    return []
  }
}

// --- IPC emission ---

function emitChanged(repoPath: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const items = discoverConfigItems(repoPath)
    mainWindow.webContents.send(IPC.CONFIG_CHANGED, repoPath, items)
  }
}

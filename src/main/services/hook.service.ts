import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getNotificationServerPort } from './notification-server'
import { getUsageTempPath, registerSession } from './usage.service'

/**
 * Write hook settings to the project's .claude/settings.local.json
 * and sync the Claude Code theme to ~/.claude.json.
 */
export function writeClaudeHookSettings(worktreePath: string, claudeTheme = 'dark', sessionId?: string) {
  const port = getNotificationServerPort()
  if (!port) return

  const claudeDir = join(worktreePath, '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  const makeHook = (type: string) => ({
    type: 'command' as const,
    command: `curl -s -X POST "http://127.0.0.1:${port}/hook?type=${type}" -H 'Content-Type: application/json' -d "$(cat)" > /dev/null 2>&1 || true`,
    timeout: 5,
  })

  const settings: Record<string, unknown> = {
    hooks: {
      UserPromptSubmit: [{ matcher: '', hooks: [makeHook('prompt')] }],
      Notification: [{ matcher: '', hooks: [makeHook('notification')] }],
      Stop: [{ matcher: '', hooks: [makeHook('stop')] }],
      // SubagentStop deliberately NOT configured — we only want main agent completion
    },
  }

  // Configure statusLine to write usage data to a temp file for this session
  if (sessionId) {
    const usagePath = getUsageTempPath(sessionId)
    settings.statusLine = {
      type: 'command',
      command: `tee "${usagePath}" > /dev/null`,
    }
    registerSession(sessionId)
  }

  const settingsPath = join(claudeDir, 'settings.local.json')

  // Read existing settings and merge if present
  let existing: Record<string, unknown> = {}
  try {
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf-8')
      existing = JSON.parse(raw)
    }
  } catch {
    // Ignore parse errors — overwrite
  }

  const merged = { ...existing, ...settings }
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n')

  // Sync theme to ~/.claude.json (the only place Claude Code reads theme from)
  syncClaudeTheme(claudeTheme)
}

/**
 * Set the Claude Code theme in ~/.claude.json.
 * Merges with existing settings to preserve other preferences.
 */
function syncClaudeTheme(claudeTheme: string) {
  const claudeJsonPath = join(homedir(), '.claude.json')
  const theme = claudeTheme

  let existing: Record<string, unknown> = {}
  try {
    if (existsSync(claudeJsonPath)) {
      const raw = readFileSync(claudeJsonPath, 'utf-8')
      existing = JSON.parse(raw)
    }
  } catch {
    // Ignore parse errors — overwrite
  }

  // Only write if theme actually changed
  if (existing.theme === theme) return

  const merged = { ...existing, theme }
  writeFileSync(claudeJsonPath, JSON.stringify(merged, null, 2) + '\n')
}

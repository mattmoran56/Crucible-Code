import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getNotificationServerPort } from './notification-server'

/**
 * Write hook settings to the project's .claude/settings.local.json
 * and sync the Claude Code theme to ~/.claude.json.
 */
export function writeClaudeHookSettings(worktreePath: string, claudeTheme = 'dark') {
  const port = getNotificationServerPort()
  if (!port) return

  const claudeDir = join(worktreePath, '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  const settings = {
    hooks: {
      Notification: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: `curl -s -X POST http://127.0.0.1:${port}/notification -H 'Content-Type: application/json' -d "$(cat)" > /dev/null 2>&1 || true`,
              timeout: 5,
            },
          ],
        },
      ],
      Stop: [
        {
          matcher: '',
          hooks: [
            {
              type: 'command',
              command: `curl -s -X POST http://127.0.0.1:${port}/notification -H 'Content-Type: application/json' -d "$(cat)" > /dev/null 2>&1 || true`,
              timeout: 5,
            },
          ],
        },
      ],
    },
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

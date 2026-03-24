import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getNotificationServerPort } from './notification-server'

export function writeClaudeHookSettings(worktreePath: string, isDark = true) {
  const port = getNotificationServerPort()
  if (!port) return

  const claudeDir = join(worktreePath, '.claude')
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }

  const settings = {
    theme: isDark ? 'dark' : 'light',
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
      const raw = require('fs').readFileSync(settingsPath, 'utf-8')
      existing = JSON.parse(raw)
    }
  } catch {
    // Ignore parse errors — overwrite
  }

  const merged = { ...existing, ...settings }
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n')
}

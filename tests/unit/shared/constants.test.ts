import { describe, expect, it } from 'vitest'
import { IPC } from '../../../src/shared/constants'

describe('IPC channel constants', () => {
  it('every value is unique (no duplicate channel names)', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('every value is a non-empty string with at least one ":" separator', () => {
    for (const v of Object.values(IPC)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      expect(v).toContain(':')
    }
  })

  it('exposes a few well-known channels', () => {
    expect(IPC.GIT_STATUS).toBe('git:status')
    expect(IPC.PR_LIST).toBe('pr:list')
    expect(IPC.NOTIFICATION_SET_BADGE).toBe('notification:set-badge')
  })

  it('groups by namespace consistently', () => {
    expect(IPC.GIT_LOG.startsWith('git:')).toBe(true)
    expect(IPC.PR_DIFF.startsWith('pr:')).toBe(true)
    expect(IPC.NOTES_LIST.startsWith('notes:')).toBe(true)
    expect(IPC.USAGE_GET_STATS.startsWith('usage:')).toBe(true)
  })
})

describe('IPC channel naming conventions', () => {
  const entries = Object.entries(IPC) as Array<[string, string]>

  it('exposes exactly 171 channels (update this count when adding channels)', () => {
    expect(entries.length).toBe(171)
  })

  it('every key is SCREAMING_SNAKE_CASE', () => {
    for (const [key] of entries) {
      expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it('no value has leading or trailing whitespace', () => {
    for (const [, value] of entries) {
      expect(value).toBe(value.trim())
    }
  })

  it('no value contains spaces or uppercase namespace prefixes', () => {
    for (const [, value] of entries) {
      expect(value).not.toMatch(/\s/)
      expect(value.split(':')[0]).toMatch(/^[a-z][a-z-]*$/)
    }
  })

  it('key prefix always matches the value namespace (kebab-cased)', () => {
    for (const [key, value] of entries) {
      const namespace = value.split(':')[0]
      expect(key.toLowerCase().replace(/_/g, '-').startsWith(namespace)).toBe(true)
    }
  })

  it('uses exactly the known set of namespaces', () => {
    const namespaces = [...new Set(entries.map(([, v]) => v.split(':')[0]))].sort()
    expect(namespaces).toEqual([
      'account', 'button', 'button-group', 'claude-web', 'file', 'git',
      'notes', 'notification', 'notion', 'permissions', 'pr', 'project',
      'remote', 'review-loop', 'scheduler', 'session', 'startup-prompt',
      'terminal', 'update', 'usage', 'worktree',
    ])
  })

  it('only update:builtCommit deviates from all-lowercase values', () => {
    const withUppercase = entries.filter(([, v]) => /[A-Z]/.test(v)).map(([, v]) => v)
    expect(withUppercase).toEqual(['update:builtCommit'])
  })

  it('every value has at most three colon-separated segments, all non-empty', () => {
    for (const [, value] of entries) {
      const segments = value.split(':')
      expect(segments.length).toBeGreaterThanOrEqual(2)
      expect(segments.length).toBeLessThanOrEqual(3)
      for (const seg of segments) expect(seg.length).toBeGreaterThan(0)
    }
  })

  it('no key duplicates either (object literal cannot, but guard against merge accidents)', () => {
    const keys = Object.keys(IPC)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('IPC namespace group sizes', () => {
  const values = Object.values(IPC) as string[]

  it('has 30 git channels', () => {
    expect(values.filter((v) => v.startsWith('git:')).length).toBe(30)
  })

  it('has 29 pr channels', () => {
    expect(values.filter((v) => v.startsWith('pr:')).length).toBe(29)
  })

  it('has 13 scheduler channels', () => {
    expect(values.filter((v) => v.startsWith('scheduler:')).length).toBe(13)
  })

  it('button-group channels do not collide with the button namespace filter', () => {
    const button = values.filter((v) => v.startsWith('button:'))
    const buttonGroup = values.filter((v) => v.startsWith('button-group:'))
    expect(button).toEqual(['button:list', 'button:save', 'button:execute'])
    expect(buttonGroup).toEqual(['button-group:list', 'button-group:save'])
  })
})

describe('IPC well-known channel spot checks', () => {
  it.each([
    ['TERMINAL_SPAWN', 'terminal:spawn'],
    ['TERMINAL_GET_BUFFER', 'terminal:get-buffer'],
    ['WORKTREE_CREATE_FROM_BRANCH', 'worktree:create-from-branch'],
    ['SESSION_CONTEXT_SAVE', 'session:context:save'],
    ['PR_THREAD_UNRESOLVE', 'pr:thread:unresolve'],
    ['UPDATE_BUILT_COMMIT', 'update:builtCommit'],
    ['SCHEDULER_SPAWN_AGENT_WITH_PROMPT', 'scheduler:spawn-agent-with-prompt'],
    ['USAGE_LIMIT_REACHED', 'usage:limit-reached'],
    ['NOTION_GET_DATABASE_SCHEMA', 'notion:get-database-schema'],
    ['REMOTE_SET_PAIRING_MODE', 'remote:set-pairing-mode'],
    ['STARTUP_PROMPT_SAVE', 'startup-prompt:save'],
    ['REVIEW_LOOP_STATE_UPDATE', 'review-loop:state:update'],
    ['CLAUDE_WEB_LIST_SESSIONS', 'claude-web:list-sessions'],
    ['FILE_READ_BASE64', 'file:read-base64'],
    ['PERMISSIONS_CHANGED', 'permissions:changed'],
  ])('%s maps to %s', (key, value) => {
    expect(IPC[key as keyof typeof IPC]).toBe(value)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  dirty: [] as string[],
  spawnTerminal: vi.fn((..._args: unknown[]) => 'term-7'),
  killTerminalsForTab: vi.fn(() => 1),
  writeClaudeHookSettings: vi.fn(),
  openExternal: vi.fn(async () => {}),
}))

vi.mock('electron', () => ({ shell: { openExternal: h.openExternal }, BrowserWindow: class {} }))
vi.mock('../../../src/main/ipc/handle', () => ({
  handle: (channel: string, fn: (...args: any[]) => any) => h.handlers.set(channel, fn),
}))
vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (a: string) => a,
  spawnTerminal: h.spawnTerminal,
  killTerminalsForTab: h.killTerminalsForTab,
}))
vi.mock('../../../src/main/services/hook.service', () => ({ writeClaudeHookSettings: h.writeClaudeHookSettings }))
vi.mock('../../../src/main/services/cloud-session.service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/main/services/cloud-session.service')>()
  return { ...real, worktreeDirtyFiles: async () => h.dirty }
})

import { registerCloudSessionHandlers } from '../../../src/main/ipc/cloud-session.ipc'
import { IPC } from '../../../src/shared/constants'

const opts = {
  sessionId: 'app-session-1',
  worktreePath: '/wt/feat',
  cloudSessionId: 'session_01abc',
  configDir: '/cfg',
  repoPath: '/repo',
  claudeTheme: 'dark',
}

beforeEach(() => {
  h.handlers.clear()
  h.dirty = []
  vi.clearAllMocks()
  registerCloudSessionHandlers({} as any)
})

const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!(undefined, ...args)

describe('cloud-session IPC', () => {
  it('registers no attach handler (cloud sessions are watched in the embedded page)', () => {
    expect([...h.handlers.keys()].some((k) => /attach/.test(k))).toBe(false)
  })

  it('teleport aborts on a dirty tree without spawning anything', async () => {
    h.dirty = ['src/a.ts']
    const result = await call(IPC.CLOUD_SESSION_TELEPORT, opts)
    expect(result).toEqual({ ok: false, reason: 'dirty', files: ['src/a.ts'] })
    expect(h.spawnTerminal).not.toHaveBeenCalled()
    expect(h.killTerminalsForTab).not.toHaveBeenCalled()
  })

  it('teleport on a clean tree replaces any old Agent-tab PTY and runs `claude --teleport <id>`', async () => {
    const result = await call(IPC.CLOUD_SESSION_TELEPORT, opts)
    expect(result).toEqual({ ok: true, terminalId: 'term-7' })
    expect(h.killTerminalsForTab).toHaveBeenCalledWith('app-session-1', 'agent')
    expect(h.writeClaudeHookSettings).toHaveBeenCalledWith('/wt/feat', 'dark', 'app-session-1')
    expect(h.spawnTerminal.mock.calls[0][6]).toBe('claude --teleport session_01abc')
  })

  it('teleport rejects an unsafe id before checking anything', async () => {
    await expect(call(IPC.CLOUD_SESSION_TELEPORT, { ...opts, cloudSessionId: '$(boom)' })).rejects.toThrow(/Invalid/)
    expect(h.spawnTerminal).not.toHaveBeenCalled()
  })

  it('only opens claude.ai URLs', async () => {
    await call(IPC.CLOUD_SESSION_OPEN_URL, 'https://claude.ai/code/session_01abc')
    expect(h.openExternal).toHaveBeenCalledWith('https://claude.ai/code/session_01abc')
    await expect(call(IPC.CLOUD_SESSION_OPEN_URL, 'file:///etc/passwd')).rejects.toThrow(/Refusing/)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// terminalStore calls destroyTerminal() to tear down xterm instances; the real
// module drags in @xterm and DOM-heavy hooks, so it is mocked wholesale.
vi.mock('../../../src/renderer/components/terminal/useTerminal', () => ({
  destroyTerminal: vi.fn(),
}))

import { useTerminalStore } from '../../../src/renderer/stores/terminalStore'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { destroyTerminal } from '../../../src/renderer/components/terminal/useTerminal'

const destroyMock = vi.mocked(destroyTerminal)

const spawn = vi.fn()
const kill = vi.fn()
const getRecoveryList = vi.fn()

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function seedTerminal(
  key: string,
  terminalId: string,
  sessionId: string,
  mode: 'shell' | 'claude' | 'review' = 'shell',
  tabId = 'agent'
) {
  useTerminalStore.setState((state: any) => ({
    terminals: {
      ...state.terminals,
      [key]: { terminalId, sessionId, sessionName: `name-${sessionId}`, mode, contextId: sessionId, tabId },
    },
  }))
}

beforeEach(() => {
  spawn.mockReset()
  kill.mockReset()
  getRecoveryList.mockReset()
  destroyMock.mockReset()
  ;(window as any).api = {
    terminal: { spawn, kill, getRecoveryList },
  }
  useTerminalStore.setState({ terminals: {} })
  useSettingsStore.setState({ claudeTheme: 'dark' } as any)
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] } as any)
})

describe('terminalStore.spawnTerminal', () => {
  it('spawns via the IPC and registers under the `${sessionId}:${mode}` key', async () => {
    spawn.mockResolvedValue('term-1')
    const id = await useTerminalStore.getState().spawnTerminal('s1', 'Session One', '/wt/s1')
    expect(id).toBe('term-1')
    expect(useTerminalStore.getState().terminals['s1:shell']).toEqual({
      terminalId: 'term-1',
      sessionId: 's1',
      sessionName: 'Session One',
      mode: 'shell',
      contextId: 's1',
      tabId: 'agent',
    })
  })

  it('defaults to shell mode, no resume, sessionId context and the agent tab', async () => {
    spawn.mockResolvedValue('term-1')
    await useTerminalStore.getState().spawnTerminal('s1', 'Session One', '/wt/s1')
    expect(spawn).toHaveBeenCalledWith(
      's1', '/wt/s1', 'shell', 'dark', undefined, undefined, false, 's1', 'agent'
    )
  })

  it('defaults the tab id to "review" for review-mode terminals', async () => {
    spawn.mockResolvedValue('term-r')
    await useTerminalStore.getState().spawnTerminal('s1', 'Session One', '/wt/s1', 'review')
    expect(spawn).toHaveBeenCalledWith(
      's1', '/wt/s1', 'review', 'dark', undefined, undefined, false, 's1', 'review'
    )
    expect(useTerminalStore.getState().terminals['s1:review'].tabId).toBe('review')
  })

  it('honours an explicit tab id over the mode default', async () => {
    spawn.mockResolvedValue('term-2')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'claude', false, undefined, 'agent:2')
    expect(spawn.mock.calls[0][8]).toBe('agent:2')
    expect(useTerminalStore.getState().terminals['s1:claude'].tabId).toBe('agent:2')
  })

  it('forwards an explicit contextId instead of the session id', async () => {
    spawn.mockResolvedValue('term-3')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'shell', false, 'ctx-9')
    expect(spawn.mock.calls[0][7]).toBe('ctx-9')
    expect(useTerminalStore.getState().terminals['s1:shell'].contextId).toBe('ctx-9')
  })

  it('passes claude theme, account config dir and repo path from sibling stores', async () => {
    useSettingsStore.setState({ claudeTheme: 'light' } as any)
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/repo', claudeAccountId: 'acc-1' }],
      activeProjectId: 'p1',
      claudeAccounts: [{ id: 'acc-1', label: 'Personal', configDir: '/cfg' }],
    } as any)
    spawn.mockResolvedValue('term-4')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'claude', true)
    expect(spawn).toHaveBeenCalledWith(
      's1', '/wt', 'claude', 'light', '/cfg', '/repo', true, 's1', 'agent'
    )
  })

  it('passes an undefined config dir when the active project has no claude account', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/repo' }],
      activeProjectId: 'p1',
      claudeAccounts: [{ id: 'acc-1', label: 'Personal', configDir: '/cfg' }],
    } as any)
    spawn.mockResolvedValue('t')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(spawn.mock.calls[0][4]).toBeUndefined()
    expect(spawn.mock.calls[0][5]).toBe('/repo')
  })

  it('passes an undefined config dir when the referenced account is missing', async () => {
    useProjectStore.setState({
      projects: [{ id: 'p1', name: 'A', repoPath: '/repo', claudeAccountId: 'acc-gone' }],
      activeProjectId: 'p1',
      claudeAccounts: [],
    } as any)
    spawn.mockResolvedValue('t')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(spawn.mock.calls[0][4]).toBeUndefined()
  })

  it('returns the existing terminal id without respawning', async () => {
    seedTerminal('s1:shell', 'existing-1', 's1')
    const id = await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(id).toBe('existing-1')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('dedupes concurrent spawns of the same key onto a single PTY', async () => {
    const d = deferred<string>()
    spawn.mockReturnValue(d.promise)
    const p1 = useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    const p2 = useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(spawn).toHaveBeenCalledTimes(1)
    d.resolve('only-pty')
    await expect(p1).resolves.toBe('only-pty')
    await expect(p2).resolves.toBe('only-pty')
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s1:shell'])
  })

  it('spawns separate PTYs for different modes of the same session', async () => {
    spawn.mockResolvedValueOnce('t-shell').mockResolvedValueOnce('t-claude')
    await Promise.all([
      useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'shell'),
      useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'claude'),
    ])
    expect(spawn).toHaveBeenCalledTimes(2)
    const keys = Object.keys(useTerminalStore.getState().terminals).sort()
    expect(keys).toEqual(['s1:claude', 's1:shell'])
  })

  it('spawns again for the same key after the previous spawn settles and was killed', async () => {
    spawn.mockResolvedValueOnce('t1')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    await useTerminalStore.getState().killTerminal('s1')
    spawn.mockResolvedValueOnce('t2')
    const id = await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(id).toBe('t2')
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('rejects and registers nothing when the spawn IPC fails', async () => {
    spawn.mockRejectedValue(new Error('no pty'))
    await expect(
      useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    ).rejects.toThrow('no pty')
    expect(useTerminalStore.getState().terminals).toEqual({})
  })

  it('clears the in-flight entry after a failure so a retry can spawn', async () => {
    spawn.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('t-retry')
    await expect(useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')).rejects.toThrow('boom')
    const id = await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt')
    expect(id).toBe('t-retry')
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})

describe('terminalStore.killTerminal', () => {
  it('destroys the xterm instance, kills the PTY and forgets the terminal', async () => {
    seedTerminal('s1:shell', 'term-1', 's1')
    await useTerminalStore.getState().killTerminal('s1')
    expect(destroyMock).toHaveBeenCalledWith('term-1')
    expect(kill).toHaveBeenCalledWith('term-1')
    expect(useTerminalStore.getState().terminals).toEqual({})
  })

  it('only removes the requested mode and leaves the sibling terminal', async () => {
    seedTerminal('s1:shell', 'term-sh', 's1', 'shell')
    seedTerminal('s1:claude', 'term-cl', 's1', 'claude')
    await useTerminalStore.getState().killTerminal('s1', 'claude')
    expect(kill).toHaveBeenCalledWith('term-cl')
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s1:shell'])
  })

  it('is a no-op when no terminal exists for the session', async () => {
    await useTerminalStore.getState().killTerminal('ghost')
    expect(destroyMock).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })
})

describe('terminalStore.getTerminal', () => {
  it('looks up the default shell mode', () => {
    seedTerminal('s1:shell', 'term-1', 's1')
    expect(useTerminalStore.getState().getTerminal('s1')?.terminalId).toBe('term-1')
  })

  it('distinguishes claude and shell modes for the same session', () => {
    seedTerminal('s1:shell', 'term-sh', 's1', 'shell')
    seedTerminal('s1:claude', 'term-cl', 's1', 'claude')
    expect(useTerminalStore.getState().getTerminal('s1', 'claude')?.terminalId).toBe('term-cl')
    expect(useTerminalStore.getState().getTerminal('s1', 'shell')?.terminalId).toBe('term-sh')
  })

  it('returns undefined for an unknown session', () => {
    expect(useTerminalStore.getState().getTerminal('nope')).toBeUndefined()
  })
})

describe('terminalStore.spawnDynamicTerminal', () => {
  it('registers under the dyn:tabId:sessionId key with resume disabled', async () => {
    spawn.mockResolvedValue('dyn-1')
    const id = await useTerminalStore
      .getState()
      .spawnDynamicTerminal('btn-1', 's1', 'Session One', '/wt', 'shell')
    expect(id).toBe('dyn-1')
    expect(spawn).toHaveBeenCalledWith(
      's1', '/wt', 'shell', 'dark', undefined, undefined, false, 's1', 'btn-1'
    )
    expect(useTerminalStore.getState().terminals['dyn:btn-1:s1']).toMatchObject({
      terminalId: 'dyn-1',
      sessionId: 's1',
      mode: 'shell',
      tabId: 'btn-1',
      contextId: 's1',
    })
  })

  it('returns the existing dynamic terminal id without respawning', async () => {
    seedTerminal('dyn:btn-1:s1', 'dyn-old', 's1', 'shell', 'btn-1')
    const id = await useTerminalStore
      .getState()
      .spawnDynamicTerminal('btn-1', 's1', 'S', '/wt', 'shell')
    expect(id).toBe('dyn-old')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('dedupes concurrent dynamic spawns for the same tab+session', async () => {
    const d = deferred<string>()
    spawn.mockReturnValue(d.promise)
    const p1 = useTerminalStore.getState().spawnDynamicTerminal('tab', 's1', 'S', '/wt', 'shell')
    const p2 = useTerminalStore.getState().spawnDynamicTerminal('tab', 's1', 'S', '/wt', 'shell')
    expect(spawn).toHaveBeenCalledTimes(1)
    d.resolve('dyn-pty')
    await expect(p1).resolves.toBe('dyn-pty')
    await expect(p2).resolves.toBe('dyn-pty')
  })

  it('keeps static and dynamic registrations in separate key spaces', async () => {
    spawn.mockResolvedValueOnce('static-id').mockResolvedValueOnce('dynamic-id')
    await useTerminalStore.getState().spawnTerminal('s1', 'S', '/wt', 'shell')
    await useTerminalStore.getState().spawnDynamicTerminal('shell', 's1', 'S', '/wt', 'shell')
    const keys = Object.keys(useTerminalStore.getState().terminals).sort()
    expect(keys).toEqual(['dyn:shell:s1', 's1:shell'])
  })

  it('forwards an explicit dynamic contextId', async () => {
    spawn.mockResolvedValue('dyn-ctx')
    await useTerminalStore.getState().spawnDynamicTerminal('tab', 's1', 'S', '/wt', 'claude', 'ctx-7')
    expect(spawn.mock.calls[0][7]).toBe('ctx-7')
    expect(useTerminalStore.getState().terminals['dyn:tab:s1'].contextId).toBe('ctx-7')
  })

  it('rejects without registering when the dynamic spawn fails, allowing retry', async () => {
    spawn.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('dyn-2')
    await expect(
      useTerminalStore.getState().spawnDynamicTerminal('tab', 's1', 'S', '/wt', 'shell')
    ).rejects.toThrow('fail')
    expect(useTerminalStore.getState().terminals).toEqual({})
    const id = await useTerminalStore.getState().spawnDynamicTerminal('tab', 's1', 'S', '/wt', 'shell')
    expect(id).toBe('dyn-2')
  })
})

describe('terminalStore.getDynamicTerminal / killDynamicTerminal', () => {
  it('getDynamicTerminal looks up by tab and session', () => {
    seedTerminal('dyn:tab-1:s1', 'dyn-1', 's1', 'shell', 'tab-1')
    expect(useTerminalStore.getState().getDynamicTerminal('tab-1', 's1')?.terminalId).toBe('dyn-1')
    expect(useTerminalStore.getState().getDynamicTerminal('tab-2', 's1')).toBeUndefined()
  })

  it('killDynamicTerminal removes only the targeted dynamic terminal', async () => {
    seedTerminal('dyn:tab-1:s1', 'dyn-a', 's1', 'shell', 'tab-1')
    seedTerminal('dyn:tab-1:s2', 'dyn-b', 's2', 'shell', 'tab-1')
    await useTerminalStore.getState().killDynamicTerminal('tab-1', 's1')
    expect(destroyMock).toHaveBeenCalledWith('dyn-a')
    expect(kill).toHaveBeenCalledWith('dyn-a')
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['dyn:tab-1:s2'])
  })

  it('killDynamicTerminal is a no-op for an unknown tab+session pair', async () => {
    await useTerminalStore.getState().killDynamicTerminal('nope', 's1')
    expect(kill).not.toHaveBeenCalled()
    expect(destroyMock).not.toHaveBeenCalled()
  })
})

describe('terminalStore.registerDynamicTerminal', () => {
  it('stores an externally spawned terminal without calling the spawn IPC', () => {
    useTerminalStore.getState().registerDynamicTerminal('btn-1', 'ext-1', 's1', 'Session One', 'shell')
    expect(spawn).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().terminals['dyn:btn-1:s1']).toEqual({
      terminalId: 'ext-1',
      sessionId: 's1',
      sessionName: 'Session One',
      mode: 'shell',
      contextId: 's1',
      tabId: 'btn-1',
    })
  })

  it('defaults the registered contextId to the session id', () => {
    useTerminalStore.getState().registerDynamicTerminal('t', 'ext-2', 's9', 'N', 'claude')
    expect(useTerminalStore.getState().terminals['dyn:t:s9'].contextId).toBe('s9')
  })

  it('respects an explicit contextId on registration', () => {
    useTerminalStore.getState().registerDynamicTerminal('t', 'ext-3', 's9', 'N', 'claude', 'pr:42')
    expect(useTerminalStore.getState().terminals['dyn:t:s9'].contextId).toBe('pr:42')
  })

  it('overwrites a previous registration for the same tab+session', () => {
    useTerminalStore.getState().registerDynamicTerminal('t', 'ext-old', 's1', 'N', 'shell')
    useTerminalStore.getState().registerDynamicTerminal('t', 'ext-new', 's1', 'N', 'shell')
    expect(useTerminalStore.getState().terminals['dyn:t:s1'].terminalId).toBe('ext-new')
    expect(Object.keys(useTerminalStore.getState().terminals)).toHaveLength(1)
  })
})

describe('terminalStore.killDynamicTerminalAll', () => {
  it('kills every dynamic terminal for the tab and leaves the rest', async () => {
    seedTerminal('dyn:tabA:s1', 'a1', 's1', 'shell', 'tabA')
    seedTerminal('dyn:tabA:s2', 'a2', 's2', 'shell', 'tabA')
    seedTerminal('dyn:tabB:s1', 'b1', 's1', 'shell', 'tabB')
    seedTerminal('s1:shell', 'static-1', 's1')
    await useTerminalStore.getState().killDynamicTerminalAll('tabA')
    expect(kill).toHaveBeenCalledTimes(2)
    expect(destroyMock).toHaveBeenCalledTimes(2)
    expect(kill.mock.calls.map((c) => c[0]).sort()).toEqual(['a1', 'a2'])
    const keys = Object.keys(useTerminalStore.getState().terminals).sort()
    expect(keys).toEqual(['dyn:tabB:s1', 's1:shell'])
  })

  it('does not treat a tab id as a prefix of a longer tab id', async () => {
    seedTerminal('dyn:tabA:s1', 'a1', 's1', 'shell', 'tabA')
    await useTerminalStore.getState().killDynamicTerminalAll('tab')
    expect(kill).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().terminals['dyn:tabA:s1']).toBeDefined()
  })

  it('is a no-op when the tab has no dynamic terminals', async () => {
    seedTerminal('s1:shell', 'static-1', 's1')
    await useTerminalStore.getState().killDynamicTerminalAll('tabZ')
    expect(kill).not.toHaveBeenCalled()
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s1:shell'])
  })
})

describe('terminalStore.killAllForSession', () => {
  it('removes static and dynamic terminals belonging to the session', async () => {
    seedTerminal('s1:shell', 't-sh', 's1', 'shell')
    seedTerminal('s1:claude', 't-cl', 's1', 'claude')
    seedTerminal('dyn:btn:s1', 't-dyn', 's1', 'shell', 'btn')
    seedTerminal('s2:shell', 't-other', 's2')
    await useTerminalStore.getState().killAllForSession('s1')
    expect(destroyMock).toHaveBeenCalledTimes(3)
    expect(destroyMock.mock.calls.map((c) => c[0]).sort()).toEqual(['t-cl', 't-dyn', 't-sh'])
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s2:shell'])
  })

  it('does not call the kill IPC (main process owns PTY cleanup on session removal)', async () => {
    seedTerminal('s1:shell', 't-sh', 's1')
    await useTerminalStore.getState().killAllForSession('s1')
    expect(kill).not.toHaveBeenCalled()
  })

  it('is a no-op when the session has no terminals', async () => {
    seedTerminal('s2:shell', 't-other', 's2')
    await useTerminalStore.getState().killAllForSession('s1')
    expect(destroyMock).not.toHaveBeenCalled()
    expect(Object.keys(useTerminalStore.getState().terminals)).toEqual(['s2:shell'])
  })
})

describe('terminalStore.recoverTerminals', () => {
  const liveSession = (id: string, name = `Session ${id}`) => ({
    id,
    name,
    worktreePath: `/wt/${id}`,
  })

  it('does nothing when the recovery list is empty', async () => {
    getRecoveryList.mockResolvedValue([])
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('respawns shell terminals without the resume flag', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-1', sessionId: 's1', mode: 'shell', cwd: '/old/cwd' },
    ])
    spawn.mockResolvedValue('new-1')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    // contextId/tabId were not persisted, so spawnTerminal applies its defaults
    expect(spawn).toHaveBeenCalledWith(
      's1', '/old/cwd', 'shell', 'dark', undefined, undefined, false, 's1', 'agent'
    )
    expect(useTerminalStore.getState().terminals['s1:shell'].terminalId).toBe('new-1')
  })

  it('respawns claude terminals with the resume flag set', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-2', sessionId: 's1', mode: 'claude', cwd: '/old/cwd' },
    ])
    spawn.mockResolvedValue('new-2')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    expect(spawn.mock.calls[0][2]).toBe('claude')
    expect(spawn.mock.calls[0][6]).toBe(true)
  })

  it('skips review-mode terminals entirely', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-r', sessionId: 's1', mode: 'review', cwd: '/old/cwd' },
    ])
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    expect(spawn).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().terminals).toEqual({})
  })

  it('skips entries whose session has been deleted', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-3', sessionId: 's-gone', mode: 'shell', cwd: '/old' },
    ])
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('passes through persisted contextId and tabId', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-4', sessionId: 's1', mode: 'shell', cwd: '/old', contextId: 'pr:7', tabId: 'agent:3' },
    ])
    spawn.mockResolvedValue('new-4')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    expect(spawn.mock.calls[0][7]).toBe('pr:7')
    expect(spawn.mock.calls[0][8]).toBe('agent:3')
  })

  it('continues recovering remaining terminals after one spawn fails', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-a', sessionId: 's1', mode: 'shell', cwd: '/a' },
      { terminalId: 'old-b', sessionId: 's2', mode: 'shell', cwd: '/b' },
    ])
    spawn.mockRejectedValueOnce(new Error('dead')).mockResolvedValueOnce('recovered-b')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1'), liveSession('s2')])
    expect(spawn).toHaveBeenCalledTimes(2)
    const terminals = useTerminalStore.getState().terminals
    expect(terminals['s1:shell']).toBeUndefined()
    expect(terminals['s2:shell'].terminalId).toBe('recovered-b')
  })

  it('uses the live session name (not anything persisted) for the recovered instance', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-5', sessionId: 's1', mode: 'shell', cwd: '/old' },
    ])
    spawn.mockResolvedValue('new-5')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1', 'Fancy Name')])
    expect(useTerminalStore.getState().terminals['s1:shell'].sessionName).toBe('Fancy Name')
  })

  it('recovers both shell and claude terminals for the same session', async () => {
    getRecoveryList.mockResolvedValue([
      { terminalId: 'old-sh', sessionId: 's1', mode: 'shell', cwd: '/wt/s1' },
      { terminalId: 'old-cl', sessionId: 's1', mode: 'claude', cwd: '/wt/s1' },
    ])
    spawn.mockResolvedValueOnce('new-sh').mockResolvedValueOnce('new-cl')
    await useTerminalStore.getState().recoverTerminals([liveSession('s1')])
    const keys = Object.keys(useTerminalStore.getState().terminals).sort()
    expect(keys).toEqual(['s1:claude', 's1:shell'])
  })
})

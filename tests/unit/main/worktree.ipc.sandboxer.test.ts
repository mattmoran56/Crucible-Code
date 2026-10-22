import { beforeEach, describe, expect, it, vi } from 'vitest'

// Deleting a session must destroy its sandboxes: before the worktree goes
// (`sandboxer down` needs its config), and with a gc sweep afterwards for any
// that survived. These pin the order and the report the renderer sees.

const handlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn) },
}))

const order: string[] = []
const worktreeService = {
  removeWorktree: vi.fn(async () => {
    order.push('remove')
  }),
  removePRWorktree: vi.fn(async () => {
    order.push('removePR')
  }),
  listPRWorktrees: vi.fn(async () => [{ prNumber: 7, path: '/wt/pr-7', branch: 'b' }]),
}
vi.mock('../../../src/main/services/worktree.service', () => worktreeService)

const sandboxerService = {
  teardownForWorktree: vi.fn(async (path: string) => {
    order.push(`teardown:${path}`)
    return { removed: ['acme/a'], failed: ['acme/b: could not load config'] }
  }),
  reapAfterRemoval: vi.fn(async (path: string) => {
    order.push(`reap:${path}`)
    return [] as Array<{ project: string; slug: string }>
  }),
}
vi.mock('../../../src/main/services/sandboxer.service', () => sandboxerService)

const { registerWorktreeHandlers } = await import('../../../src/main/ipc/worktree.ipc')
const { IPC } = await import('../../../src/shared/constants')
registerWorktreeHandlers()

beforeEach(() => {
  order.length = 0
  vi.clearAllMocks()
})

describe('worktree removal tears down sandboxes', () => {
  it('downs sandboxes before removing the worktree, then sweeps', async () => {
    const report = await handlers.get(IPC.WORKTREE_REMOVE)!(undefined, '/repo', '/wt/feat')
    expect(order).toEqual(['teardown:/wt/feat', 'remove', 'reap:/wt/feat'])
    // b failed to `down`, but gc reaped it: that counts as removed.
    expect(report).toEqual({ removed: ['acme/a', 'acme/b'], failed: [] })
  })

  it('reports a sandbox that survived both down and gc', async () => {
    sandboxerService.reapAfterRemoval.mockResolvedValueOnce([{ project: 'acme', slug: 'b' }])
    const report = await handlers.get(IPC.WORKTREE_REMOVE)!(undefined, '/repo', '/wt/feat')
    expect(report).toEqual({ removed: ['acme/a'], failed: ['acme/b: could not load config'] })
  })

  it('does the same for PR review worktrees', async () => {
    await handlers.get(IPC.WORKTREE_REMOVE_PR)!(undefined, '/repo', 7)
    expect(order).toEqual(['teardown:/wt/pr-7', 'removePR', 'reap:/wt/pr-7'])
  })

  it('does not sweep when git failed to remove the worktree', async () => {
    worktreeService.removeWorktree.mockRejectedValueOnce(new Error('locked'))
    await expect(handlers.get(IPC.WORKTREE_REMOVE)!(undefined, '/repo', '/wt/feat')).rejects.toThrow('locked')
    expect(order).toEqual(['teardown:/wt/feat'])
  })
})

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import * as jobs from '../../../src/main/services/sandboxer-jobs.service'
import { IPC } from '../../../src/shared/constants'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => {
    this.emit('close', null)
    return true
  })
}

let child: FakeChild
let spawned: Array<{ args: string[]; cwd: string }>
const send = vi.fn()
const win = { isDestroyed: () => false, webContents: { send } } as any

beforeEach(() => {
  vi.useFakeTimers()
  spawned = []
  send.mockReset()
  jobs.setSpawnForTests((args, cwd) => {
    spawned.push({ args, cwd })
    child = new FakeChild()
    return child as any
  })
})

afterEach(() => {
  jobs._resetJobs()
  jobs.setSpawnForTests()
  vi.useRealTimers()
})

async function flush() {
  await vi.advanceTimersByTimeAsync(300)
}

describe('sandboxer jobs', () => {
  it('runs the command in the worktree and tracks its steps and output', async () => {
    jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])
    expect(spawned).toEqual([{ args: ['up'], cwd: '/wt/a' }])

    child.stderr.write('==> Seeding: no database\n==> Building sandboxer/acme:f6eb\nstep 1/9\r')
    child.stdout.write('\u001b[32m  ok\u001b[0m Sandbox a is starting\n')
    await flush()

    const job = jobs.getJob('/wt/a')!
    expect(job.state).toBe('running')
    expect(job.step).toBe('Building sandboxer/acme:f6eb')
    expect(job.lines).toContain('step 1/9')
    expect(job.lines).toContain('  ok Sandbox a is starting')
    expect(send).toHaveBeenCalledWith(IPC.SANDBOXER_JOB_EVENT, expect.objectContaining({ worktreePath: '/wt/a' }))
  })

  it('records success and failure from the exit code, and pushes the final state at once', async () => {
    jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])
    child.emit('close', 0)
    expect(jobs.getJob('/wt/a')).toMatchObject({ state: 'succeeded', exitCode: 0 })
    expect(send.mock.calls.at(-1)![1]).toMatchObject({ state: 'succeeded' })

    jobs.startJob(win, '/wt/b', 'Building app', ['reload', 'b', '--web', 'app'])
    child.stderr.write('x could not build app\n')
    child.emit('close', 1)
    expect(jobs.getJob('/wt/b')).toMatchObject({ state: 'failed', exitCode: 1 })
    expect(jobs.getJob('/wt/b')!.lines).toContain('x could not build app')
  })

  it('refuses a second job on a worktree while one is running', () => {
    jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])
    expect(() => jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])).toThrow(/still running/)
    child.emit('close', 0)
    expect(() => jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])).not.toThrow()
  })

  it('cancel interrupts the process', () => {
    jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])
    jobs.cancelJob('/wt/a')
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    expect(jobs.getJob('/wt/a')!.state).toBe('failed')
  })

  it('reports a CLI that is not installed as a failed job', () => {
    jobs.startJob(win, '/wt/a', 'Starting sandbox', ['up'])
    child.emit('error', new Error('spawn sandboxer ENOENT'))
    expect(jobs.getJob('/wt/a')).toMatchObject({ state: 'failed' })
    expect(jobs.getJob('/wt/a')!.lines.at(-1)).toMatch(/ENOENT/)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  writeWhenReady,
  __resetWriteWhenReadyForTests,
} from '../../../src/renderer/lib/writeWhenReady'

const writeCalls: Array<{ terminalId: string; data: string }> = []
const dataListeners = new Set<(terminalId: string, data: string) => void>()

function emitTerminalData(terminalId: string, data: string): void {
  for (const cb of dataListeners) cb(terminalId, data)
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  writeCalls.length = 0
  dataListeners.clear()
  __resetWriteWhenReadyForTests()
  ;(window as any).api = {
    terminal: {
      write: vi.fn(async (terminalId: string, data: string) => {
        writeCalls.push({ terminalId, data })
      }),
      onData: vi.fn((cb: (terminalId: string, data: string) => void) => {
        dataListeners.add(cb)
        return () => { dataListeners.delete(cb) }
      }),
    },
  }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('writeWhenReady — prompt detection', () => {
  it('writes the command 150 ms after seeing a `>` in terminal data', async () => {
    writeWhenReady('term-1', 'go', { debug: false })
    expect(writeCalls).toHaveLength(0)

    emitTerminalData('term-1', '\r\n> ')
    await vi.advanceTimersByTimeAsync(160)

    expect(writeCalls).toEqual([{ terminalId: 'term-1', data: 'go\r' }])
  })

  it('ignores data for other terminals', async () => {
    writeWhenReady('term-1', 'go', { debug: false })
    emitTerminalData('other-term', '> ')
    await vi.advanceTimersByTimeAsync(500)
    expect(writeCalls).toHaveLength(0)
  })
})

describe('writeWhenReady — timeout fallback', () => {
  it('writes the command after the default 6s if no prompt char shows up', async () => {
    writeWhenReady('term-1', 'go', { debug: false })
    await vi.advanceTimersByTimeAsync(6_100)
    expect(writeCalls).toEqual([{ terminalId: 'term-1', data: 'go\r' }])
  })

  it('honours a custom timeoutMs', async () => {
    writeWhenReady('term-1', 'go', { debug: false, timeoutMs: 2000 })
    await vi.advanceTimersByTimeAsync(1_900)
    expect(writeCalls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(writeCalls).toEqual([{ terminalId: 'term-1', data: 'go\r' }])
  })
})

describe('writeWhenReady — MCP auto-confirm', () => {
  it('sends Enter (just \\r) when claude shows an "Allow ...?" MCP prompt', async () => {
    writeWhenReady('term-1', 'go', { debug: false })

    emitTerminalData('term-1', 'Allow Notion tools to read this workspace?')
    await vi.advanceTimersByTimeAsync(200)

    expect(writeCalls).toContainEqual({ terminalId: 'term-1', data: '\r' })
    // The queued command hasn't fired yet — only the auto-Enter.
    expect(writeCalls.some((w) => w.data === 'go\r')).toBe(false)
  })

  it('detects "Approve", "Trust", and "❯ Yes" patterns', async () => {
    writeWhenReady('term-1', 'go', { debug: false })

    emitTerminalData('term-1', 'Approve MCP tool access?')
    await vi.advanceTimersByTimeAsync(200)
    emitTerminalData('term-2', 'unrelated')

    writeWhenReady('term-3', 'go', { debug: false })
    emitTerminalData('term-3', 'Trust this MCP server?')
    await vi.advanceTimersByTimeAsync(200)

    writeWhenReady('term-4', 'go', { debug: false })
    emitTerminalData('term-4', '❯ Yes\n  No')
    await vi.advanceTimersByTimeAsync(200)

    const enters = writeCalls.filter((w) => w.data === '\r').map((w) => w.terminalId)
    expect(enters).toEqual(expect.arrayContaining(['term-1', 'term-3', 'term-4']))
  })

  it('after MCP auto-confirm, still injects the queued command on the main `>` prompt', async () => {
    writeWhenReady('term-1', 'go', { debug: false })

    emitTerminalData('term-1', 'Allow Notion tools to access this?')
    await vi.advanceTimersByTimeAsync(200)
    emitTerminalData('term-1', '\r\n> ')
    await vi.advanceTimersByTimeAsync(200)

    expect(writeCalls).toContainEqual({ terminalId: 'term-1', data: '\r' })
    expect(writeCalls).toContainEqual({ terminalId: 'term-1', data: 'go\r' })
  })

  it('respects maxAutoConfirms — too many MCP prompts does not spam Enter forever', async () => {
    writeWhenReady('term-1', 'go', { debug: false, maxAutoConfirms: 2 })

    for (let i = 0; i < 5; i++) {
      emitTerminalData('term-1', 'Allow MCP tool?')
      await vi.advanceTimersByTimeAsync(800) // throttle window is 600 ms
    }

    const enters = writeCalls.filter((w) => w.data === '\r')
    expect(enters.length).toBe(2)
  })
})

describe('writeWhenReady — dedupe', () => {
  it('repeat calls for the same terminalId become no-ops', async () => {
    writeWhenReady('term-1', 'first', { debug: false })
    writeWhenReady('term-1', 'second', { debug: false })

    emitTerminalData('term-1', '> ')
    await vi.advanceTimersByTimeAsync(200)

    // Only the first call's command lands.
    expect(writeCalls.filter((w) => w.data.endsWith('\r'))).toEqual([
      { terminalId: 'term-1', data: 'first\r' },
    ])
  })
})

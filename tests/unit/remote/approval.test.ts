// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory replacement for electron-store. The approval module instantiates
// Store at import time, so the mock factory must be hoisted along with the
// shared backing store via vi.hoisted.
const { stores, FakeStore } = vi.hoisted(() => {
  const stores: Record<string, Record<string, unknown>> = {}
  class FakeStore<T extends Record<string, unknown>> {
    private name: string
    constructor(opts: { name?: string; defaults: T }) {
      this.name = opts.name ?? 'default'
      if (!stores[this.name]) stores[this.name] = JSON.parse(JSON.stringify(opts.defaults))
    }
    get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
      return (stores[this.name][key as string] ?? defaultValue) as T[K]
    }
    set<K extends keyof T>(key: K, value: T[K]): void {
      stores[this.name][key as string] = value
    }
  }
  return { stores, FakeStore }
})

vi.mock('electron-store', () => ({ default: FakeStore }))

import {
  awaitApproval,
  listPendingPairings,
  approvePairing,
  denyPairing,
  rejectAllPending,
  setRequireApproval,
  isRequireApproval,
} from '../../../remote/server/approval'

describe('remote/server/approval', () => {
  beforeEach(() => {
    // Reset shared store values between tests so toggles don't leak. We clear
    // each bucket's keys but keep the bucket itself, since the Store instance
    // was constructed once at module import.
    for (const k of Object.keys(stores)) {
      for (const kk of Object.keys(stores[k])) delete stores[k][kk]
    }
    rejectAllPending()
  })

  afterEach(() => {
    vi.useRealTimers()
    rejectAllPending()
  })

  it('resolves true immediately when requireApproval is OFF (default)', async () => {
    expect(isRequireApproval()).toBe(false)
    await expect(awaitApproval('phone-a', 'cloud')).resolves.toBe(true)
    expect(listPendingPairings()).toHaveLength(0)
  })

  it('returns true after approvePairing when requireApproval is ON', async () => {
    setRequireApproval(true)
    const promise = awaitApproval('phone-a', 'lan')

    const pending = listPendingPairings()
    expect(pending).toHaveLength(1)
    expect(pending[0].label).toBe('phone-a')
    expect(pending[0].mode).toBe('lan')

    expect(approvePairing(pending[0].id)).toBe(true)
    await expect(promise).resolves.toBe(true)
    expect(listPendingPairings()).toHaveLength(0)
  })

  it('returns false after denyPairing when requireApproval is ON', async () => {
    setRequireApproval(true)
    const promise = awaitApproval('phone-b', 'cloud')

    const [entry] = listPendingPairings()
    expect(denyPairing(entry.id)).toBe(true)
    await expect(promise).resolves.toBe(false)
    expect(listPendingPairings()).toHaveLength(0)
  })

  it('times out (returns false) after the configured TTL', async () => {
    vi.useFakeTimers()
    setRequireApproval(true)

    const promise = awaitApproval('phone-c', 'cloud')
    expect(listPendingPairings()).toHaveLength(1)

    // TTL is 60s; push past it.
    await vi.advanceTimersByTimeAsync(60_000 + 1)

    await expect(promise).resolves.toBe(false)
    expect(listPendingPairings()).toHaveLength(0)
  })

  it('rejectAllPending resolves every pending entry with false', async () => {
    setRequireApproval(true)
    const p1 = awaitApproval('phone-x', 'cloud')
    const p2 = awaitApproval('phone-y', 'lan')
    expect(listPendingPairings()).toHaveLength(2)

    rejectAllPending()

    await expect(p1).resolves.toBe(false)
    await expect(p2).resolves.toBe(false)
    expect(listPendingPairings()).toHaveLength(0)
  })
})

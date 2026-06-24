import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stateful fakes for Electron's power APIs. The real powerSaveBlocker talks to
// the OS; here we just record start/stop calls and track which ids are active
// so we can assert the service acquires/releases correctly and re-arms.
let nextId = 1
const started = new Map<number, boolean>()
const startTypes: string[] = []
const resumeHandlers: Array<() => void> = []

const powerSaveBlocker = {
  start: vi.fn((type: string) => {
    startTypes.push(type)
    const id = nextId++
    started.set(id, true)
    return id
  }),
  stop: vi.fn((id: number) => {
    started.set(id, false)
  }),
  isStarted: vi.fn((id: number) => started.get(id) === true),
}

const powerMonitor = {
  on: vi.fn((event: string, handler: () => void) => {
    if (event === 'resume') resumeHandlers.push(handler)
  }),
  off: vi.fn((event: string, handler: () => void) => {
    if (event === 'resume') {
      const i = resumeHandlers.indexOf(handler)
      if (i >= 0) resumeHandlers.splice(i, 1)
    }
  }),
}

vi.mock('electron', () => ({ powerSaveBlocker, powerMonitor }))

/** Fire whatever resume listeners the service registered. */
function emitResume() {
  for (const h of [...resumeHandlers]) h()
}

// The service keeps module-level state (the active blocker id, the resume
// handler). Reset modules + re-import each test so every case starts clean.
async function freshService() {
  vi.resetModules()
  return import('../../../src/main/services/keep-awake.service')
}

beforeEach(() => {
  nextId = 1
  started.clear()
  startTypes.length = 0
  resumeHandlers.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('keep-awake service', () => {
  it('starts a prevent-app-suspension blocker on startKeepAwake()', async () => {
    const { startKeepAwake } = await freshService()
    startKeepAwake()

    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
    // It must be prevent-app-suspension, NOT prevent-display-sleep: we want the
    // system to stay awake while still letting the display sleep on lock.
    expect(startTypes).toEqual(['prevent-app-suspension'])
    expect(powerSaveBlocker.isStarted(1)).toBe(true)
  })

  it('is idempotent — a second start does not acquire a second blocker', async () => {
    const { startKeepAwake } = await freshService()
    startKeepAwake()
    startKeepAwake()

    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
  })

  it('registers a single resume listener even across repeated starts', async () => {
    const { startKeepAwake } = await freshService()
    startKeepAwake()
    startKeepAwake()

    expect(resumeHandlers).toHaveLength(1)
  })

  it('releases the blocker and removes the resume listener on stopKeepAwake()', async () => {
    const { startKeepAwake, stopKeepAwake } = await freshService()
    startKeepAwake()
    stopKeepAwake()

    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(1)
    expect(powerSaveBlocker.isStarted(1)).toBe(false)
    expect(resumeHandlers).toHaveLength(0)
  })

  it('re-arms after resume if the OS dropped the blocker while suspended', async () => {
    const { startKeepAwake } = await freshService()
    startKeepAwake()

    // Simulate macOS releasing our blocker during a forced sleep.
    started.set(1, false)
    emitResume()

    // A fresh blocker should have been acquired.
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2)
    expect(startTypes).toEqual(['prevent-app-suspension', 'prevent-app-suspension'])
    expect(powerSaveBlocker.isStarted(2)).toBe(true)
  })

  it('does not re-acquire on resume if the blocker is still active', async () => {
    const { startKeepAwake } = await freshService()
    startKeepAwake()

    // Blocker still alive across resume — nothing to do.
    emitResume()

    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
  })

  it('stopKeepAwake() is safe when never started', async () => {
    const { stopKeepAwake } = await freshService()
    expect(() => stopKeepAwake()).not.toThrow()
    expect(powerSaveBlocker.stop).not.toHaveBeenCalled()
  })

  it('no longer re-arms after stop (resume listener detached)', async () => {
    const { startKeepAwake, stopKeepAwake } = await freshService()
    startKeepAwake()
    stopKeepAwake()

    // Any straggler resume event must not resurrect the blocker.
    emitResume()
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1)
  })
})

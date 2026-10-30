import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOUD_KICKOFF_MESSAGE } from '../../../src/shared/cloud-session'
import {
  KICKOFF_PAGE_TIMEOUT_MS,
  KICKOFF_RETRY_MS,
  pageSendScript,
  runKickoff,
  sendFromPage,
  type KickoffDeps,
  type KickoffWebview,
} from '../../../src/renderer/lib/cloudKickoff'
import { useCloudWebPoolStore } from '../../../src/renderer/stores/cloudWebPoolStore'

/** A webview whose page is this jsdom document. */
const jsdomWebview = (): KickoffWebview => ({
  // eslint-disable-next-line no-eval
  executeJavaScript: async (code: string) => (0, eval)(code),
})

describe('pageSendScript (run in a stand-in page)', () => {
  let rect: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    // jsdom lays nothing out; every element counts as visible.
    rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 20 } as DOMRect)
  })
  afterEach(() => {
    rect.mockRestore()
    document.body.innerHTML = ''
  })

  it('types into the composer and clicks Send; reports sent once the box empties', async () => {
    document.body.innerHTML = '<form><textarea></textarea><button type="button" aria-label="Send message"></button></form>'
    const box = document.querySelector('textarea')!
    const sent: string[] = []
    document.querySelector('button')!.addEventListener('click', () => {
      sent.push(box.value)
      box.value = ''
    })
    await expect(sendFromPage(jsdomWebview(), CLOUD_KICKOFF_MESSAGE)).resolves.toBe('sent')
    expect(sent).toEqual([CLOUD_KICKOFF_MESSAGE])
  })

  it('no composer on the page (signed out, still loading)', async () => {
    document.body.innerHTML = '<p>Sign in</p>'
    await expect(sendFromPage(jsdomWebview(), 'hi')).resolves.toBe('no-composer')
  })

  it('typed but never sent: not-sent', async () => {
    vi.useFakeTimers()
    try {
      document.body.innerHTML = '<form><textarea></textarea><button type="button" aria-label="Send"></button></form>'
      const run = sendFromPage(jsdomWebview(), 'hello there')
      await vi.runAllTimersAsync()
      await expect(run).resolves.toBe('not-sent')
    } finally {
      vi.useRealTimers()
    }
  })

  it('embeds the text as a JSON literal, so quotes and backticks cannot break out', () => {
    const text = "it's `x` ${y} \")(alert(1)"
    expect(pageSendScript(text).endsWith(`})(${JSON.stringify(text)})`)).toBe(true)
  })

  it('a page that throws counts as an error', async () => {
    await expect(sendFromPage({ executeJavaScript: async () => Promise.reject(new Error('gone')) }, 'x')).resolves.toBe('error')
  })
})

describe('runKickoff', () => {
  const deps = (over: Partial<KickoffDeps>): KickoffDeps & { clock: { t: number } } => {
    const clock = { t: 0 }
    return {
      clock,
      webview: () => null,
      sendViaCli: vi.fn(async () => ({})),
      sleep: async (ms) => {
        clock.t += ms
      },
      now: () => clock.t,
      cancelled: () => false,
      ...over,
    }
  }
  const page = (...results: unknown[]): KickoffWebview => ({
    executeJavaScript: vi.fn(async () => results.shift() ?? 'no-composer'),
  })

  it('sends from the page once its composer appears; never touches the CLI', async () => {
    const wv = page('no-composer', 'no-composer', 'sent')
    const d = deps({ webview: () => wv })
    await expect(runKickoff(d)).resolves.toBe('page')
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(3)
    expect(d.sendViaCli).not.toHaveBeenCalled()
  })

  it('waits for the page to load', async () => {
    let loaded = false
    const wv = page('sent')
    const d = deps({ webview: () => (loaded ? wv : null) })
    const sleep = d.sleep
    d.sleep = async (ms) => {
      await sleep(ms)
      loaded = true
    }
    await expect(runKickoff(d)).resolves.toBe('page')
  })

  it('falls back to the CLI after the timeout, with the same message', async () => {
    const d = deps({ webview: () => page() })
    await expect(runKickoff(d)).resolves.toBe('cli')
    expect(d.sendViaCli).toHaveBeenCalledWith(CLOUD_KICKOFF_MESSAGE)
    expect(d.clock.t).toBeGreaterThanOrEqual(KICKOFF_PAGE_TIMEOUT_MS)
    expect(d.clock.t).toBeLessThan(KICKOFF_PAGE_TIMEOUT_MS + KICKOFF_RETRY_MS + 1)
  })

  it('typed but unconfirmed: no retry and no CLI (it must not arrive twice)', async () => {
    const wv = page('not-sent', 'sent')
    const d = deps({ webview: () => wv })
    await expect(runKickoff(d)).resolves.toBe('unconfirmed')
    expect(wv.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(d.sendViaCli).not.toHaveBeenCalled()
  })

  it('CLI failure is reported', async () => {
    const d = deps({ sendViaCli: vi.fn(async () => Promise.reject(new Error('no claude'))) })
    await expect(runKickoff(d)).resolves.toBe('failed')
  })

  it('stops when cancelled (session gone or teleported)', async () => {
    const d = deps({ cancelled: () => true })
    await expect(runKickoff(d)).resolves.toBe('cancelled')
    expect(d.sendViaCli).not.toHaveBeenCalled()
  })
})

describe('cloudWebPoolStore preload / pin', () => {
  beforeEach(() => useCloudWebPoolStore.setState({ entries: {}, claims: {}, webviews: {}, pinned: {} }))

  it('creates a hidden page that eviction keeps until unpinned', () => {
    const { preload, evict, unpin } = useCloudWebPoolStore.getState()
    preload('kick', 'https://claude.ai/code/session_kick')
    for (let i = 0; i < 9; i++) useCloudWebPoolStore.getState().preload(`s${i}`, `https://claude.ai/code/session_${i}`)
    for (let i = 0; i < 9; i++) useCloudWebPoolStore.getState().unpin(`s${i}`)
    expect(useCloudWebPoolStore.getState().entries.kick.load).toEqual({ kind: 'loading' })
    // 10 pages, cap 8: the two oldest unpinned go, the older pinned one stays.
    evict(new Set())
    const left = useCloudWebPoolStore.getState().entries
    expect(Object.keys(left)).toHaveLength(8)
    expect(left.kick).toBeDefined()
    expect(left.s0).toBeUndefined()
    unpin('kick')
    useCloudWebPoolStore.getState().preload('s9', 'https://claude.ai/code/session_9')
    evict(new Set(['s9']))
    expect(useCloudWebPoolStore.getState().entries.kick).toBeUndefined()
  })

  it('preloading the same url again keeps the live page', () => {
    const { preload } = useCloudWebPoolStore.getState()
    preload('a', 'https://claude.ai/code/session_a')
    const first = useCloudWebPoolStore.getState().entries.a
    preload('a', 'https://claude.ai/code/session_a')
    expect(useCloudWebPoolStore.getState().entries.a).toBe(first)
  })
})

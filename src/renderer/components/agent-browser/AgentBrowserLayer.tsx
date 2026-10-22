// The app-root layer that owns every link-browser page (see agentBrowserStore).
// Each page's <webview> is created once and never moved in the DOM — Electron
// reloads a webview's guest whenever it is reparented, and the session
// workspace re-appends the Agent tab on every layout change — and is laid
// over the placeholder its AgentBrowserSplit claims. Pages of other sessions
// stay alive but hidden at their last size.
//
// It also takes the links clicked in cloud sessions' claude.ai pages (the
// main process sends them here) and opens each in its own session's panel.
//
// Mounted once in App, for the life of the window.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AGENT_BROWSER_ENTRY_URL } from '../../../shared/agent-browser'
import { CLAUDE_WEB_PARTITION } from '../../../shared/cloud-session'
import { registerAgentBrowserControls, useAgentBrowserStore, type AgentBrowserPage } from '../../stores/agentBrowserStore'
import { CLOUD_WEB_LAYER_Z, isRendered } from '../cloud/CloudWebPool'
import { openInDefaultBrowser } from './AgentBrowserSplit'

/** Chromium's "aborted" — a navigation replaced by another; not a failure. */
const ERR_ABORTED = -3

/** The bits of Electron's <webview> element we use. */
interface WebviewElement extends HTMLElement {
  loadURL: (url: string) => Promise<void>
  goBack: () => void
  goForward: () => void
  reload: () => void
  stop: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  getTitle: () => string
  getWebContentsId: () => number
}

interface FailLoadEvent extends Event {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  isMainFrame?: boolean
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

interface Slot {
  rect: Rect | null
  shown: boolean
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/** Measure every claimed placeholder; null when nothing changed. */
function measureSlots(prev: Record<string, Slot>): Record<string, Slot> | null {
  const { pages, claims } = useAgentBrowserStore.getState()
  const next: Record<string, Slot> = {}
  let changed = Object.keys(prev).some((id) => !(id in pages))
  for (const id of Object.keys(pages)) {
    const before = prev[id] ?? { rect: null, shown: false }
    const claim = claims[id]
    let rect = before.rect
    let shown = false
    if (claim?.visible && claim.el.isConnected) {
      const r = claim.el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && isRendered(claim.el)) {
        shown = true
        rect = { top: r.top, left: r.left, width: r.width, height: r.height }
      }
    }
    const slot = shown === before.shown && sameRect(rect, before.rect) ? before : { rect, shown }
    if (slot !== before || !(id in prev)) changed = true
    next[id] = slot
  }
  return changed ? next : null
}

/**
 * The session whose claude.ai page has guest `webContentsId`, or null. The
 * cloud pages live in CloudWebPool, one slot per session.
 */
export function sessionOfCloudGuest(webContentsId: number, root: ParentNode = document): string | null {
  for (const slot of root.querySelectorAll<HTMLElement>('[data-testid="cloud-web-slot"]')) {
    const view = slot.querySelector('webview') as WebviewElement | null
    try {
      if (view?.getWebContentsId() === webContentsId) return slot.dataset.sessionId ?? null
    } catch {
      // Not attached yet.
    }
  }
  return null
}

export function AgentBrowserLayer() {
  const pages = useAgentBrowserStore((s) => s.pages)
  const claims = useAgentBrowserStore((s) => s.claims)
  const [slots, setSlots] = useState<Record<string, Slot>>({})
  const slotsRef = useRef(slots)

  const measure = useCallback(() => {
    const next = measureSlots(slotsRef.current)
    if (!next) return
    slotsRef.current = next
    setSlots(next)
  }, [])

  useLayoutEffect(measure, [measure, pages, claims])

  // While a page may be on screen, follow its placeholder every frame: the
  // panel slides and the divider drags without resizing anything we observe.
  useEffect(() => {
    if (!Object.values(claims).some((c) => c.visible)) return
    window.addEventListener('resize', measure)
    let raf = requestAnimationFrame(function tick() {
      measure()
      raf = requestAnimationFrame(tick)
    })
    return () => {
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(raf)
    }
  }, [claims, measure])

  // Links clicked in a cloud session's claude.ai page open in that session's panel.
  useEffect(
    () =>
      window.api.agentBrowser.onOpenLink(({ webContentsId, url }) => {
        const sessionId = sessionOfCloudGuest(webContentsId)
        if (sessionId) useAgentBrowserStore.getState().open(sessionId, url)
        else openInDefaultBrowser(url)
      }),
    [],
  )

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: CLOUD_WEB_LAYER_Z, pointerEvents: 'none', overflow: 'hidden' }}
      data-testid="agent-browser-layer"
    >
      {Object.values(pages).map((page) => (
        <BrowserPage key={page.sessionId} page={page} slot={slots[page.sessionId] ?? { rect: null, shown: false }} />
      ))}
    </div>
  )
}

function BrowserPage({ page, slot }: { page: AgentBrowserPage; slot: Slot }) {
  const { sessionId, url, nonce } = page
  const ref = useRef<WebviewElement | null>(null)
  const ready = useRef(false)
  const loaded = useRef(0)

  // The webview starts on about:blank (how the main process recognises it);
  // the link loads once it is attached, and again whenever one is opened.
  const load = useCallback(() => {
    const el = ref.current
    if (!el || !ready.current || loaded.current === nonce) return
    loaded.current = nonce
    el.loadURL(url).catch(() => {
      // Failures arrive as did-fail-load.
    })
  }, [url, nonce])

  useEffect(load, [load])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { setNav } = useAgentBrowserStore.getState()
    const sync = (): void => {
      try {
        const current = el.getURL()
        setNav(sessionId, {
          ...(current && current !== AGENT_BROWSER_ENTRY_URL ? { url: current } : {}),
          title: el.getTitle() === current ? '' : el.getTitle(),
          canGoBack: el.canGoBack(),
          canGoForward: el.canGoForward(),
        })
      } catch {
        // Not attached yet.
      }
    }
    const onReady = (): void => {
      ready.current = true
      sync()
      load()
    }
    const onStart = (): void => setNav(sessionId, { loading: true, error: null })
    const onStop = (): void => {
      setNav(sessionId, { loading: false })
      sync()
    }
    const onFail = (e: Event): void => {
      const { errorCode, errorDescription, isMainFrame } = e as FailLoadEvent
      if (isMainFrame === false || errorCode === ERR_ABORTED) return
      setNav(sessionId, { loading: false, error: errorDescription || `error ${errorCode ?? 'unknown'}` })
    }
    const onGone = (): void => setNav(sessionId, { loading: false, error: 'the page crashed' })
    el.addEventListener('dom-ready', onReady)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-navigate', sync)
    el.addEventListener('did-navigate-in-page', sync)
    el.addEventListener('page-title-updated', sync)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('render-process-gone', onGone)
    const unregister = registerAgentBrowserControls(sessionId, {
      back: () => el.goBack(),
      forward: () => el.goForward(),
      reload: () => {
        // After a failed load the webview is still on the previous page: retry the link.
        const nav = useAgentBrowserStore.getState().pages[sessionId]?.nav
        if (nav?.error) el.loadURL(nav.url).catch(() => {})
        else el.reload()
      },
      stop: () => el.stop(),
    })
    return () => {
      unregister()
      el.removeEventListener('dom-ready', onReady)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-navigate', sync)
      el.removeEventListener('did-navigate-in-page', sync)
      el.removeEventListener('page-title-updated', sync)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('render-process-gone', onGone)
    }
  }, [sessionId, load])

  // Never shown yet: lay out at window size so the page has a sensible width.
  const rect = slot.rect ?? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }
  const { error } = page.nav

  return (
    <div
      style={{
        position: 'absolute',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        visibility: slot.shown ? 'visible' : 'hidden',
        pointerEvents: slot.shown ? 'auto' : 'none',
      }}
      data-testid="agent-browser-slot"
      data-session-id={sessionId}
      data-shown={slot.shown ? 'true' : 'false'}
    >
      <webview
        ref={ref as React.Ref<HTMLWebViewElement>}
        src={AGENT_BROWSER_ENTRY_URL}
        partition={CLAUDE_WEB_PARTITION}
        // Lets window.open reach the main process, which loads it in this page.
        allowpopups={'true' as unknown as boolean}
        className="absolute inset-0 h-full w-full bg-white"
        data-testid="agent-browser-webview"
      />
      {error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg px-6! text-center" role="alert">
          <p className="text-[12.5px] text-text">Couldn't load this page ({error}).</p>
          <code className="max-w-full break-all font-mono text-[10.5px] text-text-muted">{page.nav.url || url}</code>
          <button
            type="button"
            onClick={() => openInDefaultBrowser(page.nav.url || url)}
            className="rounded-md border border-border px-2! py-[3px]! text-[11.5px] text-text hover:border-accent"
          >
            Open in browser
          </button>
        </div>
      ) : null}
    </div>
  )
}

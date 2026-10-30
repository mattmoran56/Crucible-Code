// The app-root layer that owns every embedded claude.ai page (see
// cloudWebPoolStore). Each page's <webview> is created once and never moved in
// the DOM — Electron reloads a webview's guest whenever it is detached and
// reattached — so switching sessions, or moving the Agent tab between
// columns, no longer reloads the page. The active page is laid over its
// CloudWebView placeholder; the others stay alive at their last size but
// hidden, so their layout and scroll position survive.
//
// Mounted once in App, for the life of the window.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CLAUDE_WEB_PARTITION } from '../../../shared/cloud-session'
import { useCloudSessionStore } from '../../stores/cloudSessionStore'
import { type CloudWebEntry, useCloudWebPoolStore } from '../../stores/cloudWebPoolStore'
import { useSessionStore } from '../../stores/sessionStore'
import { Spinner } from '../visual-agent/icons'
import { ExternalIcon } from './icons'

/**
 * Above the workspace (whose panels all sit in stacking contexts at z ≤ 1)
 * but below every overlay that can cover the Agent area: dialogs and toasts
 * (z-50, portaled to body), the column "add tab" menu (50), and menus,
 * popovers and tooltips (9998/9999, portaled to body).
 */
export const CLOUD_WEB_LAYER_Z = 45

/** Chromium's "aborted" — a navigation replaced by another; not a failure. */
const ERR_ABORTED = -3

/** Webview DOM events we listen to (Electron fires them as plain DOM events). */
interface FailLoadEvent extends Event {
  errorCode?: number
  errorDescription?: string
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

/**
 * Whether `el` is rendered visibly — not inside a `visibility:hidden` ancestor
 * (the workspace hides inactive tabs' portal targets that way) or `display:none`.
 */
export function isRendered(el: HTMLElement): boolean {
  const check = (el as HTMLElement & { checkVisibility?: (opts?: Record<string, boolean>) => boolean }).checkVisibility
  if (typeof check === 'function') return check.call(el, { visibilityProperty: true, checkVisibilityCSS: true })
  // Fallback: the nearest ancestor that sets visibility inline decides.
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const own = node.style.visibility
    if (own === 'hidden' || own === 'collapse') return false
    if (own === 'visible') break
  }
  return getComputedStyle(el).visibility !== 'hidden'
}

/** Measure every claimed placeholder; null when nothing changed. */
function measureSlots(prev: Record<string, Slot>): Record<string, Slot> | null {
  const { entries, claims } = useCloudWebPoolStore.getState()
  const next: Record<string, Slot> = {}
  let changed = Object.keys(prev).some((id) => !(id in entries))
  for (const id of Object.keys(entries)) {
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
    // Hidden pages keep their last size (layout and scroll survive).
    const slot = shown === before.shown && sameRect(rect, before.rect) ? before : { rect, shown }
    if (slot !== before || !(id in prev)) changed = true
    next[id] = slot
  }
  return changed ? next : null
}

export function CloudWebPool() {
  const entries = useCloudWebPoolStore((s) => s.entries)
  const claims = useCloudWebPoolStore((s) => s.claims)
  const [slots, setSlots] = useState<Record<string, Slot>>({})
  const slotsRef = useRef(slots)

  const measure = useCallback(() => {
    const next = measureSlots(slotsRef.current)
    if (!next) return
    const { touch } = useCloudWebPoolStore.getState()
    for (const id of Object.keys(next)) if (next[id].shown && !slotsRef.current[id]?.shown) touch(id)
    slotsRef.current = next
    setSlots(next)
  }, [])

  // Re-measure whenever a claim or entry changes…
  useLayoutEffect(measure, [measure, entries, claims])

  // …and while any page may be on screen: placeholder resizes, window resizes
  // and scrolls, plus a per-frame rect check (moving or resizing a column can
  // move the placeholder without resizing it).
  useEffect(() => {
    const live = Object.values(claims).filter((c) => c.visible)
    if (live.length === 0) return
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const c of live) ro?.observe(c.el)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    let raf = requestAnimationFrame(function tick() {
      measure()
      raf = requestAnimationFrame(tick)
    })
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      cancelAnimationFrame(raf)
    }
  }, [claims, measure])

  // Keep at most MAX_CLOUD_WEB_ENTRIES pages, never evicting a shown one.
  const shownKey = Object.keys(slots)
    .filter((id) => slots[id].shown)
    .sort()
    .join('\n')
  useEffect(() => {
    useCloudWebPoolStore.getState().evict(new Set(shownKey ? shownKey.split('\n') : []))
  }, [entries, shownKey])

  usePrunePages()

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: CLOUD_WEB_LAYER_Z, pointerEvents: 'none', overflow: 'hidden' }}
      data-testid="cloud-web-pool"
    >
      {Object.values(entries).map((entry) => (
        <PooledPage key={entry.sessionId} entry={entry} slot={slots[entry.sessionId] ?? { rect: null, shown: false }} />
      ))}
    </div>
  )
}

/**
 * Drop a session's page once it is deleted, no longer in the cloud, or
 * teleported. Sessions only cover the current project, so a page whose
 * session belongs to another project is kept until that project is open again.
 */
function usePrunePages() {
  const entries = useCloudWebPoolStore((s) => s.entries)
  const sessions = useSessionStore((s) => s.sessions)
  const currentProjectId = useSessionStore((s) => s.currentProjectId)
  const teleports = useCloudSessionStore((s) => s.teleports)
  const projectOf = useRef(new Map<string, string>())

  useEffect(() => {
    const { remove } = useCloudWebPoolStore.getState()
    for (const s of sessions) projectOf.current.set(s.id, s.projectId)
    // Mid project switch the list can still be the previous project's.
    const settled = sessions.every((s) => s.projectId === currentProjectId)
    for (const id of Object.keys(entries)) {
      const session = sessions.find((s) => s.id === id)
      if (session) {
        if (session.location !== 'cloud' || session.cloud?.teleportedAt || id in teleports) remove(id)
      } else if (id in teleports) {
        remove(id)
      } else if (settled) {
        const projectId = projectOf.current.get(id)
        if (projectId === undefined || projectId === currentProjectId) remove(id)
      }
    }
  }, [entries, sessions, currentProjectId, teleports])
}

function PooledPage({ entry, slot }: { entry: CloudWebEntry; slot: Slot }) {
  const { sessionId, url, attempt, load } = entry
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const { setLoad, setWebview } = useCloudWebPoolStore.getState()
    setWebview(sessionId, el)
    const onStop = () => setLoad(sessionId, attempt, { kind: 'ready' })
    const onFail = (e: Event) => {
      const { errorCode, errorDescription, isMainFrame } = e as FailLoadEvent
      if (isMainFrame === false || errorCode === ERR_ABORTED) return
      setLoad(sessionId, attempt, { kind: 'failed', reason: errorDescription || `error ${errorCode ?? 'unknown'}` })
    }
    const onGone = () => setLoad(sessionId, attempt, { kind: 'failed', reason: 'the page crashed' })
    el.addEventListener('dom-ready', onStop)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('render-process-gone', onGone)
    return () => {
      el.removeEventListener('dom-ready', onStop)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('render-process-gone', onGone)
      if (useCloudWebPoolStore.getState().webviews[sessionId] === el) setWebview(sessionId, null)
    }
  }, [sessionId, attempt])

  // Never shown yet: lay out at window size so the page has a sensible width.
  const rect = slot.rect ?? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }

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
      data-testid="cloud-web-slot"
      data-session-id={sessionId}
      data-shown={slot.shown ? 'true' : 'false'}
    >
      <webview
        key={`${url}#${attempt}`}
        ref={ref as React.Ref<HTMLWebViewElement>}
        src={url}
        partition={CLAUDE_WEB_PARTITION}
        // Lets window.open reach the main process's handler, which keeps
        // sign-in popups in-app and sends every other link to the browser.
        // (React needs the string form for this non-standard attribute.)
        allowpopups={'true' as unknown as boolean}
        className="absolute inset-0 h-full w-full"
        data-testid="cloud-webview"
      />

      {load.kind === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg" role="status">
          <span className="flex items-center gap-2 text-[12.5px] text-text-muted">
            <Spinner className="text-accent" /> Loading claude.ai…
          </span>
        </div>
      ) : null}

      {load.kind === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg px-6! text-center" role="alert">
          <p className="text-[12.5px] text-text">Couldn't load the cloud session page ({load.reason}).</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => useCloudWebPoolStore.getState().retry(sessionId)}
              className="rounded-md border border-border px-2! py-[3px]! text-[11.5px] text-text hover:border-accent"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void window.api.cloudSession.openUrl(url)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2! py-[3px]! text-[11.5px] text-text hover:border-accent"
            >
              <ExternalIcon size={11} /> Open in browser
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

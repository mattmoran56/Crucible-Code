import { create } from 'zustand'

/**
 * The pool of embedded claude.ai pages (one <webview> per cloud session),
 * rendered once at the app root by CloudWebPool so a page is never
 * reparented — moving a <webview> in the DOM makes Electron reload its guest,
 * and the session workspace re-appends its portal targets on every layout
 * change. CloudWebView only renders an empty placeholder and claims its
 * session's entry here; the pool positions the page over that placeholder.
 *
 * Runtime-only (never persisted). `claims` holds the live placeholder element
 * per session — DOM nodes live here only because nothing is persisted.
 */

export type CloudWebLoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; reason: string }

export interface CloudWebEntry {
  sessionId: string
  url: string
  /** Last time the page was claimed or shown (ms, strictly increasing), for LRU eviction. */
  lastUsed: number
  /** Bumped by Retry (and on url change) to recreate the webview from scratch. */
  attempt: number
  load: CloudWebLoadState
}

export interface CloudWebClaim {
  el: HTMLElement
  visible: boolean
}

/** Live pages kept beyond this are evicted, least recently used first. */
export const MAX_CLOUD_WEB_ENTRIES = 8

interface CloudWebPoolState {
  entries: Record<string, CloudWebEntry>
  claims: Record<string, CloudWebClaim>
  /** The live <webview> element per session (lib/cloudKickoff drives it). */
  webviews: Record<string, HTMLElement>
  /** Sessions whose page must stay alive though not shown (a kickoff is pending). */
  pinned: Record<string, true>
  /** Create a session's page without showing it, and keep it until unpinned. */
  preload: (sessionId: string, url: string) => void
  unpin: (sessionId: string) => void
  setWebview: (sessionId: string, el: HTMLElement | null) => void
  /**
   * A placeholder claims (or updates its claim on) its session's page. The
   * page is created the first time the placeholder is visible; a different
   * url replaces it.
   */
  claim: (sessionId: string, url: string, el: HTMLElement, visible: boolean) => void
  /** The placeholder unmounted — the page stays alive (hidden). */
  release: (sessionId: string, el: HTMLElement) => void
  /** Bump lastUsed (the page was shown). */
  touch: (sessionId: string) => void
  setLoad: (sessionId: string, attempt: number, load: CloudWebLoadState) => void
  retry: (sessionId: string) => void
  remove: (sessionId: string) => void
  /** Drop least recently used entries beyond the cap, never one in `keep`. */
  evict: (keep: ReadonlySet<string>) => void
}

// Strictly increasing so LRU order is stable even within one millisecond.
let lastTick = 0
const tick = (): number => (lastTick = Math.max(Date.now(), lastTick + 1))

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec
  const { [key]: _, ...rest } = rec
  return rest
}

export const useCloudWebPoolStore = create<CloudWebPoolState>((set, get) => ({
  entries: {},
  claims: {},
  webviews: {},
  pinned: {},

  preload: (sessionId, url) =>
    set((s) => {
      const pinned = s.pinned[sessionId] ? s.pinned : { ...s.pinned, [sessionId]: true as const }
      const prev = s.entries[sessionId]
      if (prev && prev.url === url) return pinned === s.pinned ? s : { pinned }
      const entry: CloudWebEntry = prev
        ? { sessionId, url, lastUsed: tick(), attempt: prev.attempt + 1, load: { kind: 'loading' } }
        : { sessionId, url, lastUsed: tick(), attempt: 0, load: { kind: 'loading' } }
      return { pinned, entries: { ...s.entries, [sessionId]: entry } }
    }),

  unpin: (sessionId) => set((s) => (s.pinned[sessionId] ? { pinned: without(s.pinned, sessionId) } : s)),

  setWebview: (sessionId, el) =>
    set((s) => {
      if (el) return s.webviews[sessionId] === el ? s : { webviews: { ...s.webviews, [sessionId]: el } }
      return sessionId in s.webviews ? { webviews: without(s.webviews, sessionId) } : s
    }),

  claim: (sessionId, url, el, visible) =>
    set((s) => {
      const prevClaim = s.claims[sessionId]
      const claims =
        prevClaim && prevClaim.el === el && prevClaim.visible === visible ? s.claims : { ...s.claims, [sessionId]: { el, visible } }
      const prev = s.entries[sessionId]
      let entries = s.entries
      if (prev && prev.url !== url) {
        entries = { ...entries, [sessionId]: { sessionId, url, lastUsed: tick(), attempt: prev.attempt + 1, load: { kind: 'loading' } } }
      } else if (prev && visible) {
        entries = { ...entries, [sessionId]: { ...prev, lastUsed: tick() } }
      } else if (!prev && visible) {
        entries = { ...entries, [sessionId]: { sessionId, url, lastUsed: tick(), attempt: 0, load: { kind: 'loading' } } }
      }
      return claims === s.claims && entries === s.entries ? s : { claims, entries }
    }),

  release: (sessionId, el) =>
    set((s) => (s.claims[sessionId]?.el === el ? { claims: without(s.claims, sessionId) } : s)),

  touch: (sessionId) =>
    set((s) => {
      const prev = s.entries[sessionId]
      return prev ? { entries: { ...s.entries, [sessionId]: { ...prev, lastUsed: tick() } } } : s
    }),

  setLoad: (sessionId, attempt, load) =>
    set((s) => {
      const prev = s.entries[sessionId]
      // Ignore events from a webview a retry already replaced.
      if (!prev || prev.attempt !== attempt) return s
      if (load.kind === 'ready' && prev.load.kind === 'failed') return s
      if (prev.load.kind === load.kind && load.kind !== 'failed') return s
      return { entries: { ...s.entries, [sessionId]: { ...prev, load } } }
    }),

  retry: (sessionId) =>
    set((s) => {
      const prev = s.entries[sessionId]
      return prev ? { entries: { ...s.entries, [sessionId]: { ...prev, attempt: prev.attempt + 1, load: { kind: 'loading' } } } } : s
    }),

  remove: (sessionId) => set((s) => ({ entries: without(s.entries, sessionId), pinned: without(s.pinned, sessionId) })),

  evict: (keep) => {
    const all = Object.values(get().entries)
    if (all.length <= MAX_CLOUD_WEB_ENTRIES) return
    const { pinned } = get()
    const victims = all
      .filter((e) => !keep.has(e.sessionId) && !pinned[e.sessionId])
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, all.length - MAX_CLOUD_WEB_ENTRIES)
    if (victims.length === 0) return
    set((s) => {
      const entries = { ...s.entries }
      for (const v of victims) delete entries[v.sessionId]
      return { entries }
    })
  },
}))

/** Tear down a session's embedded page (e.g. it was teleported). */
export const removeCloudWeb = (sessionId: string): void => useCloudWebPoolStore.getState().remove(sessionId)

import { create } from 'zustand'

/**
 * The Agent tab's link browser: one page per session, opened by clicking a
 * link in the conversation (or in a cloud session's claude.ai page). It
 * slides in from the right and splits the tab with the conversation.
 *
 * Like the claude.ai pages (cloudWebPoolStore), the page's <webview> lives in
 * an app-root layer (AgentBrowserLayer) and is only laid over the
 * placeholder the split claims here, so moving the Agent tab between columns
 * never reloads it.
 *
 * Runtime-only (never persisted).
 */

/** What the page is doing, as its <webview> reports it. */
export interface AgentBrowserNav {
  /** The page's current URL (follows in-page navigation). */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Set when the main frame failed to load. */
  error: string | null
}

export interface AgentBrowserPage {
  sessionId: string
  /** The last link opened in the panel. */
  url: string
  /** Bumped every time a link is opened, so opening the same link again reloads it. */
  nonce: number
  /** The browser's share of the split, 0–1. Every newly opened panel starts at half. */
  ratio: number
  nav: AgentBrowserNav
}

export interface AgentBrowserClaim {
  el: HTMLElement
  visible: boolean
}

/** Back / forward / reload / stop on a live page; registered by the layer. */
export interface AgentBrowserControls {
  back: () => void
  forward: () => void
  reload: () => void
  stop: () => void
}

export const DEFAULT_BROWSER_RATIO = 0.5
export const MIN_BROWSER_RATIO = 0.2
export const MAX_BROWSER_RATIO = 0.8

export const clampRatio = (ratio: number): number =>
  Number.isFinite(ratio) ? Math.min(MAX_BROWSER_RATIO, Math.max(MIN_BROWSER_RATIO, ratio)) : DEFAULT_BROWSER_RATIO

const freshNav = (url: string): AgentBrowserNav => ({
  url,
  title: '',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null,
})

interface AgentBrowserState {
  pages: Record<string, AgentBrowserPage>
  claims: Record<string, AgentBrowserClaim>
  /** Open `url` in a session's panel, opening the panel if it is closed. */
  open: (sessionId: string, url: string) => void
  close: (sessionId: string) => void
  setRatio: (sessionId: string, ratio: number) => void
  setNav: (sessionId: string, patch: Partial<AgentBrowserNav>) => void
  claim: (sessionId: string, el: HTMLElement, visible: boolean) => void
  release: (sessionId: string, el: HTMLElement) => void
}

let nonce = 0
const controls = new Map<string, AgentBrowserControls>()

/** The layer registers each live page's controls; the toolbar calls them. */
export const registerAgentBrowserControls = (sessionId: string, c: AgentBrowserControls): (() => void) => {
  controls.set(sessionId, c)
  return () => {
    if (controls.get(sessionId) === c) controls.delete(sessionId)
  }
}

export const agentBrowserControls = (sessionId: string): AgentBrowserControls | null => controls.get(sessionId) ?? null

export const useAgentBrowserStore = create<AgentBrowserState>((set) => ({
  pages: {},
  claims: {},

  open: (sessionId, url) =>
    set((s) => {
      const prev = s.pages[sessionId]
      return {
        pages: {
          ...s.pages,
          [sessionId]: {
            sessionId,
            url,
            nonce: ++nonce,
            ratio: prev?.ratio ?? DEFAULT_BROWSER_RATIO,
            nav: freshNav(url),
          },
        },
      }
    }),

  close: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.pages)) return s
      const pages = { ...s.pages }
      delete pages[sessionId]
      return { pages }
    }),

  setRatio: (sessionId, ratio) =>
    set((s) => {
      const page = s.pages[sessionId]
      const next = clampRatio(ratio)
      if (!page || page.ratio === next) return s
      return { pages: { ...s.pages, [sessionId]: { ...page, ratio: next } } }
    }),

  setNav: (sessionId, patch) =>
    set((s) => {
      const page = s.pages[sessionId]
      if (!page) return s
      const changed = (Object.keys(patch) as (keyof AgentBrowserNav)[]).some((k) => page.nav[k] !== patch[k])
      if (!changed) return s
      return { pages: { ...s.pages, [sessionId]: { ...page, nav: { ...page.nav, ...patch } } } }
    }),

  claim: (sessionId, el, visible) =>
    set((s) => {
      const prev = s.claims[sessionId]
      if (prev && prev.el === el && prev.visible === visible) return s
      return { claims: { ...s.claims, [sessionId]: { el, visible } } }
    }),

  release: (sessionId, el) =>
    set((s) => {
      if (s.claims[sessionId]?.el !== el) return s
      const claims = { ...s.claims }
      delete claims[sessionId]
      return { claims }
    }),
}))

// The Agent tab's link browser. Clicking a web link in the conversation opens
// it in a panel that slides in from the right; the conversation (log,
// composer and all) moves over to make room. The split starts at half and
// half, the divider drags (double-click puts it back to half), and the
// toolbar can send the page to the default browser or close the panel.
//
// The page is a <webview> on the claude.ai partition, so it shares the
// sign-ins of the cloud sessions' claude.ai pages. It lives in the app-root
// AgentBrowserLayer (moving a <webview> in the DOM reloads it); this panel
// only holds the placeholder the layer lays it over. Outside Electron
// (Storybook, tests) a stub stands in.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { isWebUrl } from '../../../shared/agent-browser'
import { cn } from '../../lib/cn'
import {
  agentBrowserControls,
  clampRatio,
  DEFAULT_BROWSER_RATIO,
  useAgentBrowserStore,
  type AgentBrowserPage,
} from '../../stores/agentBrowserStore'
import { canEmbedWebview } from '../cloud/CloudWebView'
import { CLOUD_WEB_LAYER_Z } from '../cloud/CloudWebPool'
import { ExternalIcon } from '../cloud/icons'
import { ChevronLeft, ChevronRight, Close, Restart, StopSquare } from '../visual-agent/icons'

/** How long the panel takes to slide in or out. */
export const SLIDE_MS = 200

/** Keyboard step for the divider. */
const RATIO_STEP = 0.05

/** Open a web link in the default browser (the toolbar button, and modifier-clicks). */
export const openInDefaultBrowser = (url: string): void => {
  if (isWebUrl(url)) void window.api.agentBrowser.openExternal(url)
}

/**
 * The web link a click in the conversation lands on, or null. Only absolute
 * http(s) links count: relative ones would resolve against the app itself.
 */
export function linkTarget(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target.closest('a[href]') : null
  const href = el?.getAttribute('href')?.trim()
  return isWebUrl(href) ? href : null
}

/**
 * A click on a web link opens it in the session's link browser (with a
 * modifier, in the default browser). Also used by the aside beside it.
 */
export function routeLinkClick(e: React.MouseEvent, sessionId: string): void {
  if (e.defaultPrevented || e.button !== 0) return
  const url = linkTarget(e.target)
  if (!url) return
  e.preventDefault()
  if (e.metaKey || e.ctrlKey || e.shiftKey) openInDefaultBrowser(url)
  else useAgentBrowserStore.getState().open(sessionId, url)
}

export interface AgentBrowserSplitProps {
  sessionId: string
  visible: boolean
  children: ReactNode
  /** Force the real <webview> placeholder (tests) or the stub (stories); defaults to auto-detect. */
  embed?: boolean
}

export function AgentBrowserSplit({ sessionId, visible, children, embed }: AgentBrowserSplitProps) {
  const page = useAgentBrowserStore((s) => s.pages[sessionId])
  const container = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // Slide in after the first frame at zero width; slide out before closing.
  const [shown, setShown] = useState(false)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isOpen = !!page
  useEffect(() => {
    if (!isOpen) {
      setShown(false)
      return
    }
    if (closing.current) {
      clearTimeout(closing.current)
      closing.current = null
    }
    const raf = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(raf)
  }, [isOpen, page?.nonce])
  useEffect(() => () => {
    if (closing.current) clearTimeout(closing.current)
  }, [])

  const close = useCallback(() => {
    setShown(false)
    if (closing.current) clearTimeout(closing.current)
    closing.current = setTimeout(() => {
      closing.current = null
      useAgentBrowserStore.getState().close(sessionId)
    }, SLIDE_MS)
  }, [sessionId])

  const onClickCapture = (e: React.MouseEvent): void => routeLinkClick(e, sessionId)

  const ratio = page && shown ? page.ratio : 0

  return (
    <div ref={container} className={cn('relative flex min-h-0 min-w-0 flex-1', !visible && 'hidden')} data-testid="agent-browser-split">
      <div
        className={cn(
          'flex min-h-0 min-w-0 flex-col',
          !dragging && 'transition-[width] ease-out motion-reduce:transition-none',
        )}
        style={{ width: `${(1 - ratio) * 100}%`, transitionDuration: `${SLIDE_MS}ms` }}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>

      {page ? (
        <>
          <Divider
            sessionId={sessionId}
            ratio={page.ratio}
            container={container}
            onDragging={setDragging}
          />
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-bg',
              !dragging && 'transition-[width] ease-out motion-reduce:transition-none',
            )}
            style={{ width: `${ratio * 100}%`, transitionDuration: `${SLIDE_MS}ms` }}
            role="region"
            aria-label="Link browser"
            data-testid="agent-browser"
          >
            <Toolbar page={page} onClose={close} />
            <PageSlot page={page} visible={visible && shown} embed={embed} />
          </div>
        </>
      ) : null}

      {dragging ? (
        // Webviews swallow pointer events: cover everything while dragging.
        <div className="fixed inset-0 cursor-col-resize" style={{ zIndex: CLOUD_WEB_LAYER_Z + 3 }} aria-hidden="true" />
      ) : null}
    </div>
  )
}

/* --- divider ---------------------------------------------------------------- */

function Divider({
  sessionId,
  ratio,
  container,
  onDragging,
}: {
  sessionId: string
  ratio: number
  container: React.RefObject<HTMLDivElement | null>
  onDragging: (dragging: boolean) => void
}) {
  const setRatio = (next: number): void => useAgentBrowserStore.getState().setRatio(sessionId, next)

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const box = container.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return
    e.preventDefault()
    onDragging(true)
    const move = (ev: PointerEvent): void => setRatio((box.right - ev.clientX) / box.width)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // The browser is on the right: moving the divider left widens it.
    if (e.key === 'ArrowLeft') setRatio(ratio + RATIO_STEP)
    else if (e.key === 'ArrowRight') setRatio(ratio - RATIO_STEP)
    else if (e.key === 'Home' || e.key === 'Enter') setRatio(DEFAULT_BROWSER_RATIO)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the link browser"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round((1 - clampRatio(ratio)) * 100)}
      tabIndex={0}
      title="Drag to resize · double-click for half and half"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setRatio(DEFAULT_BROWSER_RATIO)}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mx-[3px]! w-[6px] shrink-0 cursor-col-resize focus:outline-none"
      data-testid="agent-browser-divider"
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/60 group-focus-visible:bg-accent"
      />
    </div>
  )
}

/* --- toolbar ---------------------------------------------------------------- */

const TOOL_BTN =
  'grid size-6 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'

/** `https://github.com/acme/repo/pull/12` → `github.com/acme/repo/pull/12`. */
export const displayUrl = (url: string): string => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

function Toolbar({ page, onClose }: { page: AgentBrowserPage; onClose: () => void }) {
  const { nav, sessionId } = page
  const controls = (): ReturnType<typeof agentBrowserControls> => agentBrowserControls(sessionId)
  const current = nav.url || page.url

  return (
    <div className="relative flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-1.5! text-[11px]">
      <button type="button" className={TOOL_BTN} disabled={!nav.canGoBack} onClick={() => controls()?.back()} title="Back" aria-label="Back">
        <ChevronLeft size={12} />
      </button>
      <button
        type="button"
        className={TOOL_BTN}
        disabled={!nav.canGoForward}
        onClick={() => controls()?.forward()}
        title="Forward"
        aria-label="Forward"
      >
        <ChevronRight size={12} />
      </button>
      {nav.loading ? (
        <button type="button" className={TOOL_BTN} onClick={() => controls()?.stop()} title="Stop loading" aria-label="Stop loading">
          <StopSquare size={9} />
        </button>
      ) : (
        <button type="button" className={TOOL_BTN} onClick={() => controls()?.reload()} title="Reload" aria-label="Reload">
          <Restart size={11} />
        </button>
      )}

      <div className="mx-1! flex min-w-0 flex-1 items-baseline gap-2 truncate" title={current}>
        {nav.title ? <span className="truncate font-medium text-text">{nav.title}</span> : null}
        <span className="truncate font-mono text-[10.5px] text-text-muted" data-testid="agent-browser-url">
          {displayUrl(current)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => openInDefaultBrowser(current)}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5! py-[2px]! text-[11px] text-text-muted transition-colors hover:border-accent/60 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        title="Open this page in your default browser"
      >
        <ExternalIcon size={11} /> Open in browser
      </button>
      <button type="button" className={TOOL_BTN} onClick={onClose} title="Close the browser" aria-label="Close the browser">
        <Close size={10} />
      </button>

      {nav.loading ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 bottom-[-1px] h-[2px] origin-left animate-pulse bg-accent motion-reduce:animate-none"
        />
      ) : null}
    </div>
  )
}

/* --- page ------------------------------------------------------------------- */

function PageSlot({ page, visible, embed }: { page: AgentBrowserPage; visible: boolean; embed?: boolean }) {
  return (embed ?? canEmbedWebview()) ? (
    <Placeholder sessionId={page.sessionId} visible={visible} />
  ) : (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-bg-secondary px-6! text-center" data-testid="agent-browser-stub">
      <p className="text-[12.5px] text-text">The page opens here in the app.</p>
      <code className="max-w-full break-all font-mono text-[10.5px] text-text-muted">{page.url}</code>
    </div>
  )
}

/** Claims the session's page in the layer, which positions it over this box. */
function Placeholder({ sessionId, visible }: { sessionId: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el) useAgentBrowserStore.getState().claim(sessionId, el, visible)
  }, [sessionId, visible])

  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      if (el) useAgentBrowserStore.getState().release(sessionId, el)
    }
  }, [sessionId])

  return <div ref={ref} className="relative min-h-0 flex-1" data-agent-browser-placeholder={sessionId} />
}

// The real claude.ai/code session page, embedded in a cloud session's Agent
// tab so the user watches and chats exactly as on the web.
//
// It is an Electron <webview> on the persistent `persist:claude-web` partition
// (sign in once, stay signed in). The main process hardens every webview
// (no preload/Node, sandboxed, claude.ai only) and filters its navigation —
// see src/main/services/claude-web.service.ts. Outside Electron (Storybook,
// tests) there is no <webview>, so a stub stands in.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CLAUDE_WEB_PARTITION } from '../../../shared/cloud-session'
import { cn } from '../../lib/cn'
import { Spinner } from '../visual-agent/icons'
import { CloudIcon, ExternalIcon } from './icons'

/** Whether this renderer can host a <webview> (i.e. it is the Electron app). */
export const canEmbedWebview = (): boolean => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)

/** Chromium's "aborted" — a navigation replaced by another; not a failure. */
const ERR_ABORTED = -3

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; reason: string }

/** Webview DOM events we listen to (Electron fires them as plain DOM events). */
interface FailLoadEvent extends Event {
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

export interface CloudWebViewProps {
  url: string
  visible: boolean
  onOpenInBrowser: () => void
  /** Force the real <webview> (tests) or the stub (stories); defaults to auto-detect. */
  embed?: boolean
}

export function CloudWebView({ url, visible, onOpenInBrowser, embed }: CloudWebViewProps) {
  const useWebview = embed ?? canEmbedWebview()
  // Created the first time the tab is shown, then kept while the session
  // stays in the cloud (so switching tabs doesn't reload the page).
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  // Bumped by Retry to recreate the webview from scratch.
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !useWebview) return
    const onStop = () => setLoad((s) => (s.kind === 'failed' ? s : { kind: 'ready' }))
    const onFail = (e: Event) => {
      const { errorCode, errorDescription, isMainFrame } = e as FailLoadEvent
      if (isMainFrame === false || errorCode === ERR_ABORTED) return
      setLoad({ kind: 'failed', reason: errorDescription || `error ${errorCode ?? 'unknown'}` })
    }
    const onGone = () => setLoad({ kind: 'failed', reason: 'the page crashed' })
    el.addEventListener('dom-ready', onStop)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('render-process-gone', onGone)
    return () => {
      el.removeEventListener('dom-ready', onStop)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('render-process-gone', onGone)
    }
  }, [useWebview, mounted, attempt])

  const retry = useCallback(() => {
    setLoad({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return (
    <div className={cn('relative min-h-0 flex-1', !visible && 'hidden')} data-testid="cloud-web-view">
      {!mounted ? null : useWebview ? (
        <webview
          key={attempt}
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
      ) : (
        <WebStub url={url} />
      )}

      {useWebview && load.kind === 'loading' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg" role="status">
          <span className="flex items-center gap-2 text-[12.5px] text-text-muted">
            <Spinner className="text-accent" /> Loading claude.ai…
          </span>
        </div>
      ) : null}

      {useWebview && load.kind === 'failed' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg px-6! text-center" role="alert">
          <p className="text-[12.5px] text-text">Couldn't load the cloud session page ({load.reason}).</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-border px-2! py-[3px]! text-[11.5px] text-text hover:border-accent"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onOpenInBrowser}
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

/** Stand-in for the page where <webview> does not exist (Storybook, tests). */
function WebStub({ url }: { url: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-secondary text-center" data-testid="cloud-web-stub">
      <CloudIcon size={22} className="text-accent" />
      <p className="text-[12.5px] text-text">The claude.ai session page appears here in the app.</p>
      <code className="font-mono text-[10.5px] text-text-muted">{url}</code>
    </div>
  )
}

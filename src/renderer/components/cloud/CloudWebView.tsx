// The real claude.ai/code session page, embedded in a cloud session's Agent
// tab so the user watches and chats exactly as on the web.
//
// The page itself is an Electron <webview> on the persistent
// `persist:claude-web` partition (sign in once, stay signed in), owned by the
// app-root CloudWebPool: moving a <webview> in the DOM reloads its guest, and
// the session workspace re-appends its panels on every layout change. This
// component is only the placeholder the pool lays the page over. The main
// process hardens every webview (no preload/Node, sandboxed, claude.ai only)
// and filters its navigation — see src/main/services/claude-web.service.ts.
// Outside Electron (Storybook, tests) there is no <webview>, so a stub stands in.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { useCloudWebPoolStore } from '../../stores/cloudWebPoolStore'
import { CloudIcon } from './icons'

/** Whether this renderer can host a <webview> (i.e. it is the Electron app). */
export const canEmbedWebview = (): boolean => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent)

export interface CloudWebViewProps {
  /** The app session the page belongs to (the pool keeps one page per session). */
  sessionId: string
  url: string
  visible: boolean
  /** Force the real <webview> (tests) or the stub (stories); defaults to auto-detect. */
  embed?: boolean
}

export function CloudWebView({ sessionId, url, visible, embed }: CloudWebViewProps) {
  const useWebview = embed ?? canEmbedWebview()
  return useWebview ? (
    <PooledPlaceholder sessionId={sessionId} url={url} visible={visible} />
  ) : (
    <StubView url={url} visible={visible} />
  )
}

/** Claims the session's pooled page; the pool positions it over this box. */
function PooledPlaceholder({ sessionId, url, visible }: { sessionId: string; url: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const claim = useCloudWebPoolStore((s) => s.claim)
  const release = useCloudWebPoolStore((s) => s.release)

  useLayoutEffect(() => {
    const el = ref.current
    if (el) claim(sessionId, url, el, visible)
  }, [claim, sessionId, url, visible])

  useLayoutEffect(() => {
    const el = ref.current
    return () => {
      if (el) release(sessionId, el)
    }
  }, [release, sessionId])

  return <div ref={ref} className="relative min-h-0 flex-1" data-testid="cloud-web-view" data-cloud-web-placeholder={sessionId} />
}

function StubView({ url, visible }: { url: string; visible: boolean }) {
  // Created the first time the tab is shown, like the real page.
  const [mounted, setMounted] = useState(visible)
  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])
  return (
    <div className={cn('relative min-h-0 flex-1', !visible && 'hidden')} data-testid="cloud-web-view">
      {mounted ? <WebStub url={url} /> : null}
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

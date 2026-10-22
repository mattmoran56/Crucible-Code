// The app-root pool of embedded claude.ai pages: each session's <webview> is
// created once and never moved in the DOM (Electron reloads a moved webview),
// whatever happens to the CloudWebView placeholder it is laid over.
import React from 'react'
import { createPortal } from 'react-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudWebPool } from '../../../../src/renderer/components/cloud/CloudWebPool'
import { CloudWebView } from '../../../../src/renderer/components/cloud/CloudWebView'
import { MAX_CLOUD_WEB_ENTRIES, removeCloudWeb, useCloudWebPoolStore } from '../../../../src/renderer/stores/cloudWebPoolStore'
import { useCloudSessionStore } from '../../../../src/renderer/stores/cloudSessionStore'
import { useSessionStore } from '../../../../src/renderer/stores/sessionStore'

const session = (id: string) => ({
  id,
  name: id,
  branchName: `session/${id}`,
  worktreePath: `/wt/${id}`,
  projectId: 'p1',
  createdAt: '2026-10-21T00:00:00Z',
  location: 'cloud' as const,
  cloud: { sessionId: `session_${id}`, url: urlOf(id) },
})
const urlOf = (id: string) => `https://claude.ai/code/session_${id}`
const ids = Array.from({ length: 10 }, (_, i) => `s${i + 1}`)

const openUrl = vi.fn(async () => {})

beforeEach(() => {
  openUrl.mockClear()
  ;(window as any).api = { cloudSession: { openUrl } }
  useCloudWebPoolStore.setState({ entries: {}, claims: {} })
  useCloudSessionStore.setState({ teleports: {} })
  useSessionStore.setState({ sessions: ids.map(session), currentProjectId: 'p1' } as any)
  // jsdom has no layout: give placeholders a size so they count as on screen.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const sized = this.dataset.cloudWebPlaceholder !== undefined
    const [w, h] = sized ? [300, 200] : [0, 0]
    return { x: 20, y: 10, top: 10, left: 20, width: w, height: h, right: 20 + w, bottom: 10 + h, toJSON: () => ({}) } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Placeholders for `views` (session id → visible), optionally under a hidden ancestor. */
function Views({ views, hiddenAncestor }: { views: Record<string, boolean>; hiddenAncestor?: boolean }) {
  return (
    <div style={hiddenAncestor ? { visibility: 'hidden' } : undefined}>
      {Object.entries(views).map(([id, visible]) => (
        <CloudWebView key={id} sessionId={id} url={urlOf(id)} visible={visible} embed />
      ))}
    </div>
  )
}

const renderPool = (views: Record<string, boolean>) => {
  const utils = render(
    <>
      <CloudWebPool />
      <Views views={views} />
    </>
  )
  return {
    ...utils,
    show: (next: Record<string, boolean>, hiddenAncestor?: boolean) =>
      utils.rerender(
        <>
          <CloudWebPool />
          <Views views={next} hiddenAncestor={hiddenAncestor} />
        </>
      ),
  }
}

/** Let the pool's per-frame placeholder check run. */
const nextFrames = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

const slot = (id: string) => document.querySelector<HTMLElement>(`[data-testid="cloud-web-slot"][data-session-id="${id}"]`)
const webviewOf = (id: string) => slot(id)?.querySelector('webview') ?? null

describe('CloudWebPool', () => {
  it('keeps the same webview when switching sessions away and back', () => {
    const { show } = renderPool({ s1: true, s2: false })
    const first = webviewOf('s1')
    expect(first).toBeTruthy()
    expect(first!.getAttribute('src')).toBe(urlOf('s1'))
    expect(first!.getAttribute('partition')).toBe('persist:claude-web')
    expect(first!.getAttribute('allowpopups')).toBe('true')
    // s2 was never shown, so its page isn't created yet.
    expect(webviewOf('s2')).toBeNull()
    expect(slot('s1')!.style.visibility).toBe('visible')
    expect(slot('s1')!.style.width).toBe('300px')

    show({ s1: false, s2: true })
    expect(webviewOf('s2')).toBeTruthy()
    // Hidden, not unmounted, and it keeps its last size.
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('hidden')
    expect(slot('s1')!.style.pointerEvents).toBe('none')
    expect(slot('s1')!.style.width).toBe('300px')
    expect(slot('s2')!.style.visibility).toBe('visible')

    show({ s1: true, s2: false })
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('visible')
  })

  it('does not recreate the webview when the placeholder moves to another parent', () => {
    const Parent = ({ where }: { where: 'a' | 'b' }) => (
      <>
        <CloudWebPool />
        {where === 'a' ? (
          <section>
            <CloudWebView sessionId="s1" url={urlOf('s1')} visible embed />
          </section>
        ) : (
          <article>
            <CloudWebView sessionId="s1" url={urlOf('s1')} visible embed />
          </article>
        )}
      </>
    )
    const { rerender, container } = render(<Parent where="a" />)
    const first = webviewOf('s1')
    expect(first).toBeTruthy()
    rerender(<Parent where="b" />)
    expect(container.querySelector('article [data-cloud-web-placeholder="s1"]')).toBeTruthy()
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('visible')

  })

  it('survives the placeholder being re-appended in the DOM (as the workspace does with portal targets)', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const other = document.createElement('div')
    document.body.appendChild(other)
    render(
      <>
        <CloudWebPool />
        {createPortal(<CloudWebView sessionId="s1" url={urlOf('s1')} visible embed />, target)}
      </>
    )
    const first = webviewOf('s1')
    expect(first).toBeTruthy()
    other.appendChild(target)
    target.style.visibility = 'hidden'
    await nextFrames()
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('hidden')
    target.style.visibility = 'visible'
    await nextFrames()
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('visible')
  })

  it('hides the page while its placeholder is inside a visibility:hidden ancestor', async () => {
    const { show } = renderPool({ s1: true })
    const first = webviewOf('s1')
    show({ s1: true }, true)
    await nextFrames()
    expect(webviewOf('s1')).toBe(first)
    expect(slot('s1')!.style.visibility).toBe('hidden')
    show({ s1: true }, false)
    await nextFrames()
    expect(slot('s1')!.style.visibility).toBe('visible')
  })

  it(`evicts the least recently used page beyond ${MAX_CLOUD_WEB_ENTRIES}, never the shown one`, () => {
    const { show } = renderPool({ s1: true })
    for (let i = 2; i <= MAX_CLOUD_WEB_ENTRIES + 1; i++) {
      show(Object.fromEntries(ids.slice(0, i).map((id, j) => [id, j === i - 1])))
    }
    const live = Object.keys(useCloudWebPoolStore.getState().entries)
    expect(live).toHaveLength(MAX_CLOUD_WEB_ENTRIES)
    expect(live).not.toContain('s1')
    expect(webviewOf('s1')).toBeNull()
    expect(webviewOf(`s${MAX_CLOUD_WEB_ENTRIES + 1}`)).toBeTruthy()
    expect(slot(`s${MAX_CLOUD_WEB_ENTRIES + 1}`)!.style.visibility).toBe('visible')
  })

  it('drops the page when its session is deleted', () => {
    renderPool({ s1: true, s2: false })
    expect(webviewOf('s1')).toBeTruthy()
    act(() => useSessionStore.setState({ sessions: ids.filter((id) => id !== 's1').map(session) } as any))
    expect(webviewOf('s1')).toBeNull()
  })

  it('drops the page when the session is teleported or leaves the cloud', () => {
    const { show } = renderPool({ s1: true, s2: false, s3: false })
    show({ s1: false, s2: true, s3: false })
    show({ s1: false, s2: false, s3: true })
    expect(webviewOf('s1')).toBeTruthy()
    expect(webviewOf('s2')).toBeTruthy()

    // A teleport in progress this run.
    act(() => useCloudSessionStore.setState({ teleports: { s1: 'term-1' } }))
    expect(webviewOf('s1')).toBeNull()

    // Teleported (recorded on the session).
    act(() =>
      useSessionStore.setState({
        sessions: ids.map((id) =>
          id === 's2' ? { ...session(id), location: 'local', cloud: { ...session(id).cloud, teleportedAt: '2026-10-21T09:00:00Z' } } : session(id)
        ),
      } as any)
    )
    expect(webviewOf('s2')).toBeNull()

    // No longer a cloud session.
    act(() => useSessionStore.setState({ sessions: ids.map((id) => (id === 's3' ? { ...session(id), location: 'local' } : session(id))) } as any))
    expect(webviewOf('s3')).toBeNull()
  })

  it('removeCloudWeb drops a page explicitly', () => {
    renderPool({ s1: true })
    act(() => removeCloudWeb('s1'))
    expect(webviewOf('s1')).toBeNull()
  })

  it('replaces the page when the url changes', () => {
    const { rerender } = render(
      <>
        <CloudWebPool />
        <CloudWebView sessionId="s1" url={urlOf('s1')} visible embed />
      </>
    )
    const first = webviewOf('s1')
    rerender(
      <>
        <CloudWebPool />
        <CloudWebView sessionId="s1" url="https://claude.ai/code/session_other" visible embed />
      </>
    )
    expect(webviewOf('s1')).not.toBe(first)
    expect(webviewOf('s1')!.getAttribute('src')).toBe('https://claude.ai/code/session_other')
  })

  describe('load states', () => {
    const fire = (el: Element, type: string, props: Record<string, unknown> = {}) =>
      act(() => {
        el.dispatchEvent(Object.assign(new Event(type), props))
      })

    it('shows a spinner until the page has loaded', () => {
      renderPool({ s1: true })
      expect(screen.getByRole('status').textContent).toMatch(/Loading claude\.ai/)
      fire(webviewOf('s1')!, 'did-stop-loading')
      expect(screen.queryByRole('status')).toBeNull()
    })

    it('shows Retry and Open in browser when the main frame fails; Retry recreates the webview', () => {
      renderPool({ s1: true })
      const view = webviewOf('s1')!
      fire(view, 'did-fail-load', { errorCode: -3, errorDescription: 'ERR_ABORTED', isMainFrame: true })
      fire(view, 'did-fail-load', { errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', isMainFrame: false })
      expect(screen.queryByRole('alert')).toBeNull()
      fire(view, 'did-fail-load', { errorCode: -106, errorDescription: 'ERR_INTERNET_DISCONNECTED', isMainFrame: true })
      expect(screen.getByRole('alert').textContent).toMatch(/ERR_INTERNET_DISCONNECTED/)
      // A late stop-loading doesn't hide the failure.
      fire(view, 'did-stop-loading')
      expect(screen.getByRole('alert')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /Open in browser/ }))
      expect(openUrl).toHaveBeenCalledWith(urlOf('s1'))
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(screen.queryByRole('alert')).toBeNull()
      expect(webviewOf('s1')).not.toBe(view)
      expect(screen.getByRole('status')).toBeTruthy()
    })
  })
})

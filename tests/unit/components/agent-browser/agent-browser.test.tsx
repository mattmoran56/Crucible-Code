// The Agent tab's link browser: links in the conversation open in a panel
// that splits the tab with it, rather than in a bare Electron window.
import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBrowserLayer, sessionOfCloudGuest } from '../../../../src/renderer/components/agent-browser/AgentBrowserLayer'
import { AgentBrowserSplit, displayUrl, linkTarget, SLIDE_MS } from '../../../../src/renderer/components/agent-browser/AgentBrowserSplit'
import { clampRatio, useAgentBrowserStore } from '../../../../src/renderer/stores/agentBrowserStore'

const openExternal = vi.fn(async () => {})
let linkListener: ((link: { webContentsId: number; url: string }) => void) | null = null

beforeEach(() => {
  openExternal.mockClear()
  linkListener = null
  ;(window as any).api = {
    agentBrowser: {
      openExternal,
      onOpenLink: (cb: typeof linkListener) => {
        linkListener = cb
        return () => (linkListener = null)
      },
    },
  }
  useAgentBrowserStore.setState({ pages: {}, claims: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const Conversation = () => (
  <div>
    <a href="https://github.com/acme/repo/pull/12" target="_blank" rel="noreferrer">
      the PR
    </a>
    <a href="notes.md">relative</a>
    <a href="mailto:a@example.com">mail</a>
  </div>
)

const renderSplit = () =>
  render(
    <AgentBrowserSplit sessionId="s1" visible embed={false}>
      <Conversation />
    </AgentBrowserSplit>,
  )

describe('agentBrowserStore', () => {
  it('opens a page at half width and keeps the width when another link opens', () => {
    const { open, setRatio } = useAgentBrowserStore.getState()
    open('s1', 'https://a.example/')
    expect(useAgentBrowserStore.getState().pages.s1).toMatchObject({ url: 'https://a.example/', ratio: 0.5 })
    setRatio('s1', 0.7)
    const before = useAgentBrowserStore.getState().pages.s1.nonce
    open('s1', 'https://b.example/')
    expect(useAgentBrowserStore.getState().pages.s1).toMatchObject({ url: 'https://b.example/', ratio: 0.7 })
    expect(useAgentBrowserStore.getState().pages.s1.nonce).toBeGreaterThan(before)
  })

  it('starts at half again once closed and reopened', () => {
    const { open, setRatio, close } = useAgentBrowserStore.getState()
    open('s1', 'https://a.example/')
    setRatio('s1', 0.3)
    close('s1')
    open('s1', 'https://a.example/')
    expect(useAgentBrowserStore.getState().pages.s1.ratio).toBe(0.5)
  })

  it('keeps the split within bounds', () => {
    expect(clampRatio(0.01)).toBe(0.2)
    expect(clampRatio(0.99)).toBe(0.8)
    expect(clampRatio(Number.NaN)).toBe(0.5)
  })
})

it('only absolute web links are taken over', () => {
  const box = document.createElement('div')
  box.innerHTML = '<a href="https://x.example/a"><span>in</span></a><a href="/rel">r</a><a href="javascript:alert(1)">j</a>'
  const [web, rel, js] = Array.from(box.querySelectorAll('a'))
  expect(linkTarget(web.firstChild as Element)).toBe('https://x.example/a')
  expect(linkTarget(rel)).toBeNull()
  expect(linkTarget(js)).toBeNull()
  expect(displayUrl('https://github.com/acme/')).toBe('github.com/acme')
})

describe('AgentBrowserSplit', () => {
  it('opens a clicked link in the panel instead of a new window', () => {
    renderSplit()
    expect(screen.queryByTestId('agent-browser')).toBeNull()
    const click = fireEvent.click(screen.getByText('the PR'))
    expect(click).toBe(false) // default prevented: no popup window
    expect(useAgentBrowserStore.getState().pages.s1?.url).toBe('https://github.com/acme/repo/pull/12')
    expect(screen.getByTestId('agent-browser')).toBeTruthy()
    expect(screen.getByTestId('agent-browser-url').textContent).toBe('github.com/acme/repo/pull/12')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('leaves relative and mailto links alone', () => {
    renderSplit()
    fireEvent.click(screen.getByText('relative'))
    fireEvent.click(screen.getByText('mail'))
    expect(useAgentBrowserStore.getState().pages.s1).toBeUndefined()
  })

  it('cmd-click sends the link straight to the default browser', () => {
    renderSplit()
    fireEvent.click(screen.getByText('the PR'), { metaKey: true })
    expect(openExternal).toHaveBeenCalledWith('https://github.com/acme/repo/pull/12')
    expect(useAgentBrowserStore.getState().pages.s1).toBeUndefined()
  })

  it('"Open in browser" opens the current page in the default browser', () => {
    renderSplit()
    fireEvent.click(screen.getByText('the PR'))
    act(() => useAgentBrowserStore.getState().setNav('s1', { url: 'https://github.com/acme/repo/pull/12/files' }))
    fireEvent.click(screen.getByRole('button', { name: /open in browser/i }))
    expect(openExternal).toHaveBeenCalledWith('https://github.com/acme/repo/pull/12/files')
  })

  it('closes the panel after it slides out', () => {
    vi.useFakeTimers()
    renderSplit()
    fireEvent.click(screen.getByText('the PR'))
    fireEvent.click(screen.getByRole('button', { name: 'Close the browser' }))
    expect(useAgentBrowserStore.getState().pages.s1).toBeDefined()
    act(() => vi.advanceTimersByTime(SLIDE_MS))
    expect(useAgentBrowserStore.getState().pages.s1).toBeUndefined()
    expect(screen.queryByTestId('agent-browser')).toBeNull()
  })

  it('the divider resizes from the keyboard and resets on double-click', () => {
    renderSplit()
    fireEvent.click(screen.getByText('the PR'))
    const divider = screen.getByRole('separator', { name: /resize the link browser/i })
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    expect(useAgentBrowserStore.getState().pages.s1.ratio).toBeCloseTo(0.55)
    fireEvent.doubleClick(divider)
    expect(useAgentBrowserStore.getState().pages.s1.ratio).toBe(0.5)
  })

  it('the divider drags', () => {
    renderSplit()
    fireEvent.click(screen.getByText('the PR'))
    const split = screen.getByTestId('agent-browser-split')
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000, top: 0, bottom: 500, height: 500 } as DOMRect)
    // jsdom has no PointerEvent: MouseEvents carry the button and coordinates.
    act(() => {
      screen.getByTestId('agent-browser-divider').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 500, bubbles: true }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 }))
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
    expect(useAgentBrowserStore.getState().pages.s1.ratio).toBeCloseTo(0.7)
  })
})

describe('links from a cloud session’s claude.ai page', () => {
  const cloudSlot = (sessionId: string, guestId: number) => {
    const slot = document.createElement('div')
    slot.setAttribute('data-testid', 'cloud-web-slot')
    slot.dataset.sessionId = sessionId
    const view = document.createElement('webview') as HTMLElement & { getWebContentsId: () => number }
    view.getWebContentsId = () => guestId
    slot.appendChild(view)
    return slot
  }

  it('finds the session a guest belongs to', () => {
    const root = document.createElement('div')
    root.append(cloudSlot('s1', 11), cloudSlot('s2', 22))
    expect(sessionOfCloudGuest(22, root)).toBe('s2')
    expect(sessionOfCloudGuest(33, root)).toBeNull()
  })

  it("opens the link in that session's panel, or the default browser when it has none", () => {
    const slot = cloudSlot('s2', 22)
    document.body.appendChild(slot)
    render(<AgentBrowserLayer />)
    act(() => linkListener!({ webContentsId: 22, url: 'https://github.com/acme/repo' }))
    expect(useAgentBrowserStore.getState().pages.s2?.url).toBe('https://github.com/acme/repo')
    act(() => linkListener!({ webContentsId: 99, url: 'https://example.com/' }))
    expect(openExternal).toHaveBeenCalledWith('https://example.com/')
    slot.remove()
  })
})

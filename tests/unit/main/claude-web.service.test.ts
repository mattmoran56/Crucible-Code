import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const ses = {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) crucible-code/1.4.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36',
    setUserAgent: vi.fn(),
    getUserAgent: () => ses.ua,
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  }
  const appListeners = new Map<string, (...args: any[]) => void>()
  const app = {
    getName: () => 'Crucible Code',
    on: vi.fn((event: string, fn: (...args: any[]) => void) => appListeners.set(event, fn)),
    emit: (event: string, ...args: any[]) => appListeners.get(event)?.(...args),
  }
  return { ses, app, fromPartition: vi.fn(() => ses), openExternal: vi.fn(async () => {}) }
})

vi.mock('electron', () => ({
  app: h.app,
  session: { fromPartition: h.fromPartition },
  shell: { openExternal: h.openExternal },
}))

import {
  chromeUserAgent,
  configureClaudeWebPartition,
  guardAgentBrowserContents,
  guardAppWindowContents,
  guardClaudeWebContents,
  hardenWebviewAttach,
  installClaudeWebGuards,
  isAllowedAgentBrowserNavigation,
  isAllowedClaudeWebNavigation,
  isAllowedClaudeWebPermission,
  isClaudeWebEntryUrl,
} from '../../../src/main/services/claude-web.service'
import { CLAUDE_WEB_PARTITION } from '../../../src/shared/cloud-session'

beforeEach(() => vi.clearAllMocks())

describe('isAllowedClaudeWebNavigation', () => {
  it.each([
    'https://claude.ai/code/session_01abc',
    'https://claude.ai/login?returnTo=%2Fcode',
    'https://www.anthropic.com/legal',
    'https://console.anthropic.com/',
    'https://claude.com/',
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://appleid.apple.com/auth/authorize',
    'https://github.com/login/oauth/authorize',
    'about:blank',
  ])('allows %s', (url) => expect(isAllowedClaudeWebNavigation(url)).toBe(true))

  it.each([
    'http://claude.ai/code', // not https
    'https://claude.ai.evil.com/', // suffix trick
    'https://evilclaude.ai/',
    'https://user:pw@claude.ai/', // credentials in URL
    'https://example.com/',
    'https://mail.google.com/', // only accounts.google.com
    'https://gist.github.com/', // only github.com itself
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('blocks %s', (url) => expect(isAllowedClaudeWebNavigation(url)).toBe(false))
})

it('only claude.ai pages may be the initial webview page', () => {
  expect(isClaudeWebEntryUrl('https://claude.ai/code/session_01abc')).toBe(true)
  expect(isClaudeWebEntryUrl('https://accounts.google.com/')).toBe(false)
  expect(isClaudeWebEntryUrl('http://claude.ai/')).toBe(false)
})

it('grants clipboard writes and denies every other permission', () => {
  expect(isAllowedClaudeWebPermission('clipboard-sanitized-write')).toBe(true)
  for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'fullscreen', 'midi']) {
    expect(isAllowedClaudeWebPermission(p)).toBe(false)
  }
})

describe('chromeUserAgent', () => {
  it('strips the Electron and app tokens, keeping a plain Chrome UA', () => {
    const ua = chromeUserAgent(h.ses.ua, 'Crucible Code')
    expect(ua).toBe(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36'
    )
    expect(ua).not.toMatch(/Electron|crucible/i)
  })
})

describe('hardenWebviewAttach', () => {
  const good = { src: 'https://claude.ai/code/session_01abc', partition: CLAUDE_WEB_PARTITION }

  it('strips preload and forces isolation, sandbox and no Node', () => {
    const prefs: Record<string, unknown> = {
      preload: '/evil.js',
      preloadURL: 'file:///evil.js',
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
    }
    expect(hardenWebviewAttach(prefs, good)).toBe('claude')
    expect(prefs).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      partition: CLAUDE_WEB_PARTITION,
    })
    expect(prefs.preload).toBeUndefined()
    expect(prefs.preloadURL).toBeUndefined()
  })

  it('refuses a webview on another partition or pointed elsewhere', () => {
    expect(hardenWebviewAttach({}, { ...good, partition: 'persist:other' })).toBeNull()
    expect(hardenWebviewAttach({}, { ...good, partition: undefined })).toBeNull()
    expect(hardenWebviewAttach({}, { ...good, src: 'https://example.com/' })).toBeNull()
    expect(hardenWebviewAttach({}, { ...good, src: undefined })).toBeNull()
  })

  it('recognises the link browser by its blank entry page, hardened the same way', () => {
    const prefs: Record<string, unknown> = { preload: '/evil.js', nodeIntegration: true, sandbox: false }
    expect(hardenWebviewAttach(prefs, { src: 'about:blank', partition: CLAUDE_WEB_PARTITION })).toBe('browser')
    expect(prefs).toMatchObject({ nodeIntegration: false, sandbox: true, contextIsolation: true })
    expect(prefs.preload).toBeUndefined()
    expect(hardenWebviewAttach({}, { src: 'about:blank', partition: 'persist:other' })).toBeNull()
  })
})

/** A fake WebContents that records its listeners and window-open handler. */
function fakeContents(type = 'webview', id = 7) {
  const listeners = new Map<string, (...args: any[]) => void>()
  let openHandler: ((d: { url: string }) => any) | null = null
  return {
    id,
    getType: () => type,
    isDestroyed: () => false,
    send: vi.fn(),
    loadURL: vi.fn(async () => {}),
    on: vi.fn((event: string, fn: (...args: any[]) => void) => listeners.set(event, fn)),
    setWindowOpenHandler: vi.fn((fn: (d: { url: string }) => any) => (openHandler = fn)),
    emit: (event: string, ...args: any[]) => listeners.get(event)?.(...args),
    open: (url: string) => openHandler!({ url }),
  }
}

describe('guardClaudeWebContents', () => {
  it('keeps allowed navigation in the view and sends the rest to the browser', () => {
    const wc = fakeContents()
    guardClaudeWebContents(wc as any)
    for (const event of ['will-navigate', 'will-redirect']) {
      const ok = { preventDefault: vi.fn() }
      wc.emit(event, ok, 'https://claude.ai/code')
      expect(ok.preventDefault).not.toHaveBeenCalled()
      const bad = { preventDefault: vi.fn() }
      wc.emit(event, bad, 'https://example.com/docs')
      expect(bad.preventDefault).toHaveBeenCalled()
    }
    expect(h.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('never hands non-web schemes to the OS', () => {
    const wc = fakeContents()
    guardClaudeWebContents(wc as any)
    const e = { preventDefault: vi.fn() }
    wc.emit('will-navigate', e, 'file:///Applications/Calculator.app')
    expect(e.preventDefault).toHaveBeenCalled()
    expect(h.openExternal).not.toHaveBeenCalled()
  })

  it('keeps Google/Apple sign-in popups in-app (sandboxed, same partition) and opens other links externally', () => {
    const wc = fakeContents()
    guardClaudeWebContents(wc as any)
    const google = wc.open('https://accounts.google.com/o/oauth2/auth')
    expect(google.action).toBe('allow')
    expect(google.overrideBrowserWindowOptions.webPreferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: CLAUDE_WEB_PARTITION,
    })
    expect(wc.open('https://github.com/acme/repo/pull/12')).toEqual({ action: 'deny' })
    expect(h.openExternal).toHaveBeenCalledWith('https://github.com/acme/repo/pull/12')
  })

  it('hands links to a custom opener when given one', () => {
    const wc = fakeContents()
    const openLink = vi.fn()
    guardClaudeWebContents(wc as any, openLink)
    expect(wc.open('https://github.com/acme/repo/pull/12')).toEqual({ action: 'deny' })
    const e = { preventDefault: vi.fn() }
    wc.emit('will-navigate', e, 'https://example.com/docs')
    expect(e.preventDefault).toHaveBeenCalled()
    expect(openLink.mock.calls.map((c) => c[0])).toEqual(['https://github.com/acme/repo/pull/12', 'https://example.com/docs'])
    expect(h.openExternal).not.toHaveBeenCalled()
  })
})

describe('isAllowedAgentBrowserNavigation', () => {
  it.each(['https://github.com/acme/repo/pull/12', 'http://localhost:3000/', 'https://example.com/a?b#c', 'about:blank'])(
    'allows %s',
    (url) => expect(isAllowedAgentBrowserNavigation(url)).toBe(true),
  )
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'mailto:a@b.c', 'vscode://file/x', 'https://u:p@example.com/', 'nope'])(
    'blocks %s',
    (url) => expect(isAllowedAgentBrowserNavigation(url)).toBe(false),
  )
})

describe('guardAgentBrowserContents', () => {
  it('browses any web page but never loads other schemes', () => {
    const wc = fakeContents()
    guardAgentBrowserContents(wc as any)
    const ok = { preventDefault: vi.fn() }
    wc.emit('will-navigate', ok, 'https://example.com/')
    expect(ok.preventDefault).not.toHaveBeenCalled()
    const file = { preventDefault: vi.fn() }
    wc.emit('will-redirect', file, 'file:///etc/passwd')
    expect(file.preventDefault).toHaveBeenCalled()
    const mail = { preventDefault: vi.fn() }
    wc.emit('will-navigate', mail, 'mailto:a@example.com')
    expect(mail.preventDefault).toHaveBeenCalled()
    expect(h.openExternal.mock.calls).toEqual([['mailto:a@example.com']])
  })

  it('opens new-window links in the panel itself, keeping sign-in popups', () => {
    const wc = fakeContents()
    guardAgentBrowserContents(wc as any)
    expect(wc.open('https://example.com/next')).toEqual({ action: 'deny' })
    expect(wc.loadURL).toHaveBeenCalledWith('https://example.com/next')
    expect(wc.open('file:///etc/passwd')).toEqual({ action: 'deny' })
    expect(wc.loadURL).toHaveBeenCalledTimes(1)
    expect(wc.open('https://accounts.google.com/o/oauth2/auth').action).toBe('allow')
  })
})

it('the app window opens no windows of its own: web links go to the system browser', () => {
  const wc = fakeContents('window')
  guardAppWindowContents(wc as any)
  expect(wc.open('https://github.com/acme/repo')).toEqual({ action: 'deny' })
  expect(h.openExternal).toHaveBeenCalledWith('https://github.com/acme/repo')
  expect(wc.open('file:///etc/passwd')).toEqual({ action: 'deny' })
  expect(h.openExternal).toHaveBeenCalledTimes(1)
})

describe('partition + attach wiring', () => {
  it('configures the persistent claude-web partition once', () => {
    configureClaudeWebPartition()
    configureClaudeWebPartition()
    expect(h.fromPartition).toHaveBeenCalledTimes(1)
    expect(h.fromPartition).toHaveBeenCalledWith('persist:claude-web')
    expect(h.ses.setUserAgent.mock.calls[0][0]).not.toMatch(/Electron/)
    const request = h.ses.setPermissionRequestHandler.mock.calls[0][0]
    const cb = vi.fn()
    request(null, 'media', cb)
    expect(cb).toHaveBeenCalledWith(false)
    request(null, 'clipboard-sanitized-write', cb)
    expect(cb).toHaveBeenLastCalledWith(true)
  })

  it('blocks a bad webview at will-attach-webview and guards attached guests', () => {
    const host = fakeContents()
    installClaudeWebGuards(host as any)
    const bad = { preventDefault: vi.fn() }
    host.emit('will-attach-webview', bad, {}, { src: 'https://example.com', partition: CLAUDE_WEB_PARTITION })
    expect(bad.preventDefault).toHaveBeenCalled()
    const good = { preventDefault: vi.fn() }
    const prefs: Record<string, unknown> = { preload: '/x.js' }
    host.emit('will-attach-webview', good, prefs, { src: 'https://claude.ai/code/x', partition: CLAUDE_WEB_PARTITION })
    expect(good.preventDefault).not.toHaveBeenCalled()
    expect(prefs.preload).toBeUndefined()
    const guest = fakeContents()
    h.app.emit('web-contents-created', {}, guest)
    host.emit('did-attach-webview', {}, guest)
    expect(guest.setWindowOpenHandler).toHaveBeenCalled()
  })

  it("sends the claude.ai page's links to the renderer's link browser", () => {
    const host = fakeContents('window', 1)
    installClaudeWebGuards(host as any)
    host.emit('will-attach-webview', { preventDefault: vi.fn() }, {}, { src: 'https://claude.ai/code/x', partition: CLAUDE_WEB_PARTITION })
    const guest = fakeContents('webview', 42)
    h.app.emit('web-contents-created', {}, guest)
    host.emit('did-attach-webview', {}, guest)
    expect(guest.open('https://github.com/acme/repo/pull/12')).toEqual({ action: 'deny' })
    expect(host.send).toHaveBeenCalledWith('agent-browser:open-link', { webContentsId: 42, url: 'https://github.com/acme/repo/pull/12' })
    expect(h.openExternal).not.toHaveBeenCalled()
  })

  it('gives the link browser its own guards', () => {
    const host = fakeContents('window', 1)
    installClaudeWebGuards(host as any)
    const event = { preventDefault: vi.fn() }
    host.emit('will-attach-webview', event, {}, { src: 'about:blank', partition: CLAUDE_WEB_PARTITION })
    expect(event.preventDefault).not.toHaveBeenCalled()
    const guest = fakeContents('webview', 43)
    h.app.emit('web-contents-created', {}, guest)
    host.emit('did-attach-webview', {}, guest)
    const nav = { preventDefault: vi.fn() }
    guest.emit('will-navigate', nav, 'https://example.com/')
    expect(nav.preventDefault).not.toHaveBeenCalled()
    expect(guest.open('https://example.com/next')).toEqual({ action: 'deny' })
    expect(guest.loadURL).toHaveBeenCalledWith('https://example.com/next')
  })

  it('blocks the app window from opening popups', () => {
    const host = fakeContents('window', 1)
    installClaudeWebGuards(host as any)
    expect(host.setWindowOpenHandler).toHaveBeenCalled()
  })
})

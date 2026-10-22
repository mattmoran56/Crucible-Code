/**
 * The embedded claude.ai/code page a cloud session's Agent tab shows.
 *
 * The renderer hosts it in a `<webview>` (not an iframe — claude.ai and its
 * Cloudflare front door send `X-Frame-Options: SAMEORIGIN`, which a webview's
 * top-level guest page is not subject to). Everything that makes that safe
 * lives here, in the main process, where the renderer cannot loosen it:
 *
 * - `will-attach-webview` forces the guest's webPreferences (no preload, no
 *   Node, context isolation + sandbox on) and refuses any webview that is not
 *   on our dedicated partition or not pointed at claude.ai.
 * - The partition (`persist:claude-web`) is persistent so the user signs in
 *   once, and isolated from the app's own session.
 * - In-view navigation is limited to claude.ai / anthropic.com and the sign-in
 *   providers claude.ai uses; anything else opens in the system browser.
 * - Permission requests are denied except clipboard writes (the page's "copy"
 *   buttons).
 * - The partition reports a plain Chrome user agent: Google sign-in rejects
 *   user agents carrying an `Electron/x` token as "not a secure browser".
 *
 * The Agent tab's link browser (the panel links open in) is a second kind of
 * guest on the same partition, so it shares the claude.ai page's sign-ins.
 * It is created on `about:blank` (AGENT_BROWSER_ENTRY_URL), which is how
 * will-attach-webview tells it apart, and gets its own guards: any web page,
 * nothing else. Links the claude.ai page opens go to that panel.
 */
import { app, session as electronSession, shell, type WebContents } from 'electron'
import { AGENT_BROWSER_ENTRY_URL, isWebUrl, type AgentBrowserLinkEvent } from '../../shared/agent-browser'
import { CLAUDE_WEB_PARTITION } from '../../shared/cloud-session'
import { IPC } from '../../shared/constants'

/** Hosts (and their subdomains) the embedded page may navigate to. */
export const CLAUDE_WEB_HOSTS = ['claude.ai', 'claude.com', 'anthropic.com'] as const

/**
 * Exact hosts claude.ai sign-in legitimately sends the page to: Google and
 * Apple SSO, and GitHub (connecting the GitHub app from Claude Code on the
 * web). Enterprise SSO hosts are arbitrary and go to the system browser.
 */
export const CLAUDE_WEB_AUTH_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'github.com'] as const

const parse = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const hostMatches = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`)

/** Whether the embedded claude.ai view may load `url` itself. */
export function isAllowedClaudeWebNavigation(url: string): boolean {
  if (url === 'about:blank') return true
  const u = parse(url)
  if (!u || u.protocol !== 'https:' || u.username || u.password) return false
  const host = u.hostname.toLowerCase()
  return (
    CLAUDE_WEB_HOSTS.some((d) => hostMatches(host, d)) ||
    (CLAUDE_WEB_AUTH_HOSTS as readonly string[]).includes(host)
  )
}

/** Whether a webview may be created pointing at `url` (its initial page). */
export const isClaudeWebEntryUrl = (url: string): boolean => {
  const u = parse(url)
  return !!u && u.protocol === 'https:' && u.hostname === 'claude.ai'
}

/** URLs we are willing to hand to the system browser. */
export const isExternalOpenable = (url: string): boolean => {
  const u = parse(url)
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:')
}

/** Permissions the claude.ai page is granted; everything else is denied. */
export const CLAUDE_WEB_ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])

export const isAllowedClaudeWebPermission = (permission: string): boolean =>
  CLAUDE_WEB_ALLOWED_PERMISSIONS.has(permission)

/**
 * A normal Chrome user agent: Electron's default with the `Electron/x` and
 * app-name tokens removed (Electron's Chrome token already matches the
 * bundled Chromium).
 */
export function chromeUserAgent(electronUa: string, appName = app?.getName?.() ?? ''): string {
  let ua = electronUa.replace(/\s?Electron\/\S+/g, '')
  const names = [appName, appName.replace(/\s+/g, '-'), 'crucible-code', 'codecrucible'].filter(Boolean)
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ua = ua.replace(new RegExp(`\\s?${escaped}\\/\\S+`, 'gi'), '')
  }
  return ua.replace(/\s{2,}/g, ' ').trim()
}

/** Minimal shape of Electron's will-attach-webview webPreferences we touch. */
export interface GuestWebPreferences {
  preload?: string
  nodeIntegration?: boolean
  nodeIntegrationInSubFrames?: boolean
  contextIsolation?: boolean
  sandbox?: boolean
  webSecurity?: boolean
  allowRunningInsecureContent?: boolean
  partition?: string
  [key: string]: unknown
}

/** The two kinds of embedded page: a cloud session's claude.ai page, or the Agent tab's link browser. */
export type WebviewRole = 'claude' | 'browser'

/**
 * Harden a webview's preferences in place and say which kind of page it is.
 * Returns null when the webview must not be attached at all (wrong partition,
 * or neither a claude.ai page nor the link browser's blank entry page).
 */
export function hardenWebviewAttach(
  prefs: GuestWebPreferences,
  params: { src?: string; partition?: string },
): WebviewRole | null {
  delete prefs.preload
  delete (prefs as Record<string, unknown>).preloadURL
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webSecurity = true
  prefs.allowRunningInsecureContent = false
  if (params.partition !== CLAUDE_WEB_PARTITION || !params.src) return null
  prefs.partition = CLAUDE_WEB_PARTITION
  if (params.src === AGENT_BROWSER_ENTRY_URL) return 'browser'
  return isClaudeWebEntryUrl(params.src) ? 'claude' : null
}

export const openExternally = (url: string): void => {
  if (isExternalOpenable(url)) void shell.openExternal(url)
}

/** Where a link the claude.ai page opens should go (default: the system browser). */
export type LinkOpener = (url: string) => void

/**
 * Google / Apple sign-in may use a popup that talks back to its opener: keep
 * those in the app, in a sandboxed window on the same partition.
 */
function signInPopup(url: string) {
  const u = parse(url)
  if (!u || !(CLAUDE_WEB_AUTH_HOSTS as readonly string[]).includes(u.hostname) || u.hostname === 'github.com') return null
  return {
    action: 'allow' as const,
    overrideBrowserWindowOptions: {
      width: 520,
      height: 680,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: CLAUDE_WEB_PARTITION },
    },
  }
}

/** Lock down one claude.ai guest page (and any sign-in popups it opens). */
export function guardClaudeWebContents(contents: WebContents, openLink: LinkOpener = openExternally): void {
  const onNavigate = (event: { preventDefault: () => void }, url: string): void => {
    if (isAllowedClaudeWebNavigation(url)) return
    event.preventDefault()
    openLink(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onNavigate)
  contents.setWindowOpenHandler(({ url }) => {
    const popup = signInPopup(url)
    if (popup) return popup
    openLink(url)
    return { action: 'deny' }
  })
  // Popups are not in any session's Agent tab: their links go to the browser.
  contents.on('did-create-window', (child) => guardClaudeWebContents(child.webContents))
}

/** Whether the link browser may load `url` itself: any web page, nothing else. */
export function isAllowedAgentBrowserNavigation(url: string): boolean {
  if (url === 'about:blank') return true
  const u = parse(url)
  return !!u && (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password
}

/**
 * Lock down the Agent tab's link browser: it may browse the web, but other
 * schemes (file:, custom app protocols) never load in it — mailto: goes to the
 * OS, the rest is dropped. Pages that open a new window navigate the panel
 * instead, except sign-in popups that need their opener.
 */
export function guardAgentBrowserContents(contents: WebContents): void {
  const onNavigate = (event: { preventDefault: () => void }, url: string): void => {
    if (isAllowedAgentBrowserNavigation(url)) return
    event.preventDefault()
    if (url.startsWith('mailto:')) openExternally(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onNavigate)
  contents.setWindowOpenHandler(({ url }) => {
    const popup = signInPopup(url)
    if (popup) return popup
    if (isAllowedAgentBrowserNavigation(url) && url !== 'about:blank') void contents.loadURL(url)
    else if (url.startsWith('mailto:')) openExternally(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) => guardClaudeWebContents(child.webContents))
}

/**
 * The app window itself never opens windows: a stray `target="_blank"` link
 * or `window.open` goes to the system browser rather than a bare, signed-out
 * Electron window.
 */
export function guardAppWindowContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })
}

let partitionConfigured = false

/** One-time setup of the claude.ai partition: user agent and permissions. */
export function configureClaudeWebPartition(): void {
  if (partitionConfigured) return
  partitionConfigured = true
  const ses = electronSession.fromPartition(CLAUDE_WEB_PARTITION)
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()))
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isAllowedClaudeWebPermission(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedClaudeWebPermission(permission))
}

/**
 * The role decided at will-attach-webview, waiting for its guest. Electron
 * creates the guest's WebContents synchronously right after the event (in the
 * same call), so `web-contents-created` picks it up before anything else can
 * attach; did-attach-webview fires later, with only the guest to go on.
 */
let attachingRole: WebviewRole | null = null
const guestRoles = new WeakMap<WebContents, WebviewRole>()
let trackingGuests = false

function trackGuestRoles(): void {
  if (trackingGuests) return
  trackingGuests = true
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview' || !attachingRole) return
    guestRoles.set(contents, attachingRole)
    attachingRole = null
  })
}

/**
 * Install the guards on the app window. Every webview the renderer creates
 * goes through `will-attach-webview`; guests on our partition get the
 * navigation guards for their role as soon as they exist. Links the claude.ai
 * page opens are offered to the renderer's link browser for that session.
 */
export function installClaudeWebGuards(host: WebContents): void {
  configureClaudeWebPartition()
  trackGuestRoles()
  guardAppWindowContents(host)
  host.on('will-attach-webview', (event, webPreferences, params) => {
    const role = hardenWebviewAttach(webPreferences as GuestWebPreferences, params)
    if (!role) event.preventDefault()
    attachingRole = role
  })
  host.on('did-attach-webview', (_event, guest) => {
    // Unknown means we could not tell: the claude.ai guards are the strict ones.
    if (guestRoles.get(guest) === 'browser') {
      guardAgentBrowserContents(guest)
      return
    }
    guardClaudeWebContents(guest, (url) => {
      if (!isWebUrl(url) || host.isDestroyed()) return openExternally(url)
      const link: AgentBrowserLinkEvent = { webContentsId: guest.id, url }
      host.send(IPC.AGENT_BROWSER_OPEN_LINK, link)
    })
  })
}

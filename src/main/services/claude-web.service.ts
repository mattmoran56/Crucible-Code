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
 */
import { app, session as electronSession, shell, type WebContents } from 'electron'
import { CLAUDE_WEB_PARTITION } from '../../shared/cloud-session'

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

/**
 * Harden a webview's preferences in place. Returns false when the webview
 * must not be attached at all (wrong partition or not a claude.ai page).
 */
export function hardenWebviewAttach(prefs: GuestWebPreferences, params: { src?: string; partition?: string }): boolean {
  delete prefs.preload
  delete (prefs as Record<string, unknown>).preloadURL
  prefs.nodeIntegration = false
  prefs.nodeIntegrationInSubFrames = false
  prefs.contextIsolation = true
  prefs.sandbox = true
  prefs.webSecurity = true
  prefs.allowRunningInsecureContent = false
  if (params.partition !== CLAUDE_WEB_PARTITION) return false
  prefs.partition = CLAUDE_WEB_PARTITION
  return !!params.src && isClaudeWebEntryUrl(params.src)
}

const openExternally = (url: string): void => {
  if (isExternalOpenable(url)) void shell.openExternal(url)
}

/** Lock down one claude.ai guest page (and any sign-in popups it opens). */
export function guardClaudeWebContents(contents: WebContents): void {
  const onNavigate = (event: { preventDefault: () => void }, url: string): void => {
    if (isAllowedClaudeWebNavigation(url)) return
    event.preventDefault()
    openExternally(url)
  }
  contents.on('will-navigate', onNavigate)
  contents.on('will-redirect', onNavigate)
  contents.setWindowOpenHandler(({ url }) => {
    // Google / Apple sign-in may use a popup that talks back to its opener:
    // keep those in the app (same partition, same guards via
    // did-create-window below). Everything else goes to the browser.
    const u = parse(url)
    if (u && (CLAUDE_WEB_AUTH_HOSTS as readonly string[]).includes(u.hostname) && u.hostname !== 'github.com') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: CLAUDE_WEB_PARTITION },
        },
      }
    }
    openExternally(url)
    return { action: 'deny' }
  })
  contents.on('did-create-window', (child) => guardClaudeWebContents(child.webContents))
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
 * Install the guards on the app window. Every webview the renderer creates
 * goes through `will-attach-webview`; guests on our partition get the
 * navigation guards as soon as they exist.
 */
export function installClaudeWebGuards(host: WebContents): void {
  configureClaudeWebPartition()
  host.on('will-attach-webview', (event, webPreferences, params) => {
    if (!hardenWebviewAttach(webPreferences as GuestWebPreferences, params)) event.preventDefault()
  })
  host.on('did-attach-webview', (_event, guest) => guardClaudeWebContents(guest))
}

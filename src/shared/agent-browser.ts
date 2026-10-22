// Shared bits of the Agent tab's link browser: the panel that slides in from
// the right of the Agent tab when a link in the conversation is clicked.

/**
 * The page the link browser's <webview> is created on. It loads the link
 * once attached; the main process tells it apart from the claude.ai page
 * (same partition, so the same sign-ins) by this entry URL.
 */
export const AGENT_BROWSER_ENTRY_URL = 'about:blank'

/** Whether `url` is a web page the link browser (or the system browser) may open. */
export function isWebUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** main → renderer: a link clicked inside a cloud session's claude.ai page. */
export interface AgentBrowserLinkEvent {
  /** The claude.ai guest the link was clicked in. */
  webContentsId: number
  url: string
}

// Starting a new cloud session's work from the embedded claude.ai page.
//
// claude.ai attaches the user's connectors (Notion, Slack, Gmail…) to a cloud
// session only when a message from the claude.ai web client arrives; the
// `claude --cloud <task>` create message carries none, so a session that
// starts working on it runs its first turn — usually the whole task — without
// any connectors. So the create task tells the agent to hold
// (withConnectorHold, main process), the new session is saved with
// `cloud.kickoffPending`, and this module sends CLOUD_KICKOFF_MESSAGE from the
// session's embedded page (loaded hidden if its tab is not on screen). If the
// page cannot send it in time (signed out, the composer not found), the
// message goes through the CLI instead so the task still starts, and the user
// is told the connectors attach with their first message from claude.ai.

import { useEffect } from 'react'
import { CLOUD_KICKOFF_MESSAGE } from '../../shared/cloud-session'
import type { Session } from '../../shared/types'
import { canEmbedWebview } from '../components/cloud/CloudWebView'
import { useCloudWebPoolStore } from '../stores/cloudWebPoolStore'
import { useProjectStore } from '../stores/projectStore'
import { useSessionStore } from '../stores/sessionStore'
import { useToastStore } from '../stores/toastStore'
import { projectConfigDir } from './visualAgents'

/** How long the page gets to send the kickoff before the CLI fallback. */
export const KICKOFF_PAGE_TIMEOUT_MS = 90_000
/** Pause between attempts while the page loads or its composer appears. */
export const KICKOFF_RETRY_MS = 3_000

/** What a page attempt reported (see PAGE_SEND_SCRIPT). */
export type PageSendResult = 'sent' | 'no-composer' | 'not-typed' | 'not-sent' | 'error'

/**
 * The bit of Electron's <webview> element the kickoff uses. (Never its
 * focus(): that would take the keyboard from whatever the user is typing in.)
 */
export interface KickoffWebview {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>
}

/**
 * Runs inside the claude.ai page: put `text` in the message composer, submit
 * it, and report whether the composer emptied (the message went). Works on a
 * textarea or a contenteditable editor (ProseMirror), and submits with the
 * send button or, failing that, Enter. No assumptions beyond "the last visible
 * editable box is the composer" — the page is not ours.
 */
export const pageSendScript = (text: string): string => `(async (text) => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }
  const boxes = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')]
    .filter((el) => visible(el) && !el.disabled && !el.readOnly && !el.closest('[aria-hidden="true"]'))
  const box = boxes[boxes.length - 1]
  if (!box) return 'no-composer'
  const read = () => ('value' in box ? box.value : box.innerText || '').trim()
  box.focus()
  if (box instanceof HTMLTextAreaElement) {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  } else {
    getSelection()?.selectAllChildren(box)
    if (!document.execCommand('insertText', false, text)) {
      const data = new DataTransfer()
      data.setData('text/plain', text)
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }
  }
  if (!read().includes(text.slice(0, 24))) return 'not-typed'
  await new Promise((r) => setTimeout(r, 300))
  const scope = box.closest('form') || box.closest('fieldset') || document
  const send = [...scope.querySelectorAll('button')]
    .filter((b) => visible(b) && !b.disabled && /send|submit/i.test((b.getAttribute('aria-label') || '') + ' ' + b.type))
    .pop()
  if (send) send.click()
  else box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250))
    if (!read()) return 'sent'
  }
  return 'not-sent'
})(${JSON.stringify(text)})`

/** One attempt at sending `text` from the page. */
export async function sendFromPage(webview: KickoffWebview, text: string): Promise<PageSendResult> {
  try {
    const result = await webview.executeJavaScript(pageSendScript(text), true)
    return result === 'sent' || result === 'no-composer' || result === 'not-typed' || result === 'not-sent' ? result : 'error'
  } catch {
    return 'error'
  }
}

export interface KickoffDeps {
  /** The session's page, once it exists and has loaded; null until then. */
  webview: () => KickoffWebview | null
  /** Send through the CLI (`claude -p <msg> --cloud <id>`). */
  sendViaCli: (message: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  now: () => number
  /** Stop early (the session went away or was teleported). */
  cancelled: () => boolean
}

export type KickoffOutcome = 'page' | 'cli' | 'unconfirmed' | 'failed' | 'cancelled'

/**
 * Send the kickoff from the page, retrying until KICKOFF_PAGE_TIMEOUT_MS, then
 * fall back to the CLI. A page attempt that typed but could not confirm the
 * send ('not-sent') is neither retried nor followed by the CLI — it may have
 * gone, and the agent must not get the kickoff twice.
 */
export async function runKickoff(deps: KickoffDeps, timeoutMs = KICKOFF_PAGE_TIMEOUT_MS): Promise<KickoffOutcome> {
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    if (deps.cancelled()) return 'cancelled'
    const webview = deps.webview()
    if (webview) {
      const result = await sendFromPage(webview, CLOUD_KICKOFF_MESSAGE)
      if (result === 'sent') return 'page'
      if (result === 'not-sent') return 'unconfirmed'
    }
    await deps.sleep(KICKOFF_RETRY_MS)
  }
  if (deps.cancelled()) return 'cancelled'
  try {
    await deps.sendViaCli(CLOUD_KICKOFF_MESSAGE)
    return 'cli'
  } catch {
    return 'failed'
  }
}

/** Sessions with a kickoff running in this app run. */
const running = new Set<string>()

/** Test hook. */
export function _resetKickoffs(): void {
  running.clear()
}

const needsKickoff = (s: Session): boolean =>
  s.location === 'cloud' && !!s.cloud?.kickoffPending && !s.cloud.teleportedAt

/** Clear `kickoffPending` on the saved session. */
async function markKickedOff(projectId: string, sessionId: string): Promise<void> {
  const store = useSessionStore.getState()
  const clear = (s: Session): Partial<Session> | null =>
    s.cloud?.kickoffPending ? { cloud: { ...s.cloud, kickoffPending: undefined } } : null
  if (store.currentProjectId === projectId) {
    const session = store.sessions.find((s) => s.id === sessionId)
    const patch = session ? clear(session) : null
    if (patch) await store.patchSession(projectId, sessionId, patch)
    return
  }
  const list = await window.api.session.list(projectId)
  const session = list.find((s) => s.id === sessionId)
  const patch = session ? clear(session) : null
  if (patch) await window.api.session.save(projectId, list.map((s) => (s.id === sessionId ? { ...s, ...patch } : s)))
}

async function kickOff(session: Session): Promise<void> {
  const cloud = session.cloud
  if (!cloud || running.has(session.id)) return
  running.add(session.id)
  const pool = useCloudWebPoolStore.getState()
  pool.preload(session.id, cloud.url)
  const current = () => useSessionStore.getState().sessions.find((s) => s.id === session.id)
  const outcome = await runKickoff({
    webview: () => {
      const { entries, webviews } = useCloudWebPoolStore.getState()
      return entries[session.id]?.load.kind === 'ready' ? ((webviews[session.id] as unknown as KickoffWebview) ?? null) : null
    },
    sendViaCli: (message) => {
      const project = useProjectStore.getState().projects.find((p) => p.id === session.projectId)
      return window.api.cloudSession.send({
        worktreePath: session.worktreePath,
        cloudSessionId: cloud.sessionId,
        message,
        configDir: projectConfigDir(project, useProjectStore.getState().claudeAccounts),
      })
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    cancelled: () => {
      const s = current()
      // Another project is open: the session is not in the list, keep going.
      if (!s) return useSessionStore.getState().currentProjectId === session.projectId
      return !needsKickoff(s) || s.cloud?.sessionId !== cloud.sessionId
    },
  })
  useCloudWebPoolStore.getState().unpin(session.id)
  if (outcome === 'cancelled') {
    running.delete(session.id)
    return
  }
  // Stays in `running` for this app run, so a failed save never sends it twice.
  await markKickedOff(session.projectId, session.id).catch(() => {})
  const toast = useToastStore.getState().addToast
  if (outcome === 'cli') {
    toast(
      'info',
      `Started cloud session "${session.name}" without the claude.ai page, so its claude.ai connectors are not attached yet. Send any message from its claude.ai page to attach them.`
    )
  } else if (outcome === 'unconfirmed') {
    toast(
      'info',
      `Couldn't confirm cloud session "${session.name}" got its start message. If its claude.ai page shows the message still in the box, press Send.`
    )
  } else if (outcome === 'failed') {
    toast(
      'error',
      `Couldn't start cloud session "${session.name}" automatically. Open its claude.ai page and send "Start the task now."`
    )
  }
}

/**
 * App-level: send the kickoff for every cloud session of the open project that
 * is waiting for one. A kickoff interrupted by an app restart runs again.
 */
export function useCloudKickoffBootstrap(): void {
  const sessions = useSessionStore((s) => s.sessions)
  useEffect(() => {
    // Outside Electron there is no page to send from (tests, Storybook).
    if (!canEmbedWebview()) return
    for (const s of sessions) if (needsKickoff(s)) void kickOff(s)
  }, [sessions])
}

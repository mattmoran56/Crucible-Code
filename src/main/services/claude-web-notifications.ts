/**
 * Relays the web notifications a cloud session's embedded claude.ai/code page
 * raises (Claude Code on the web notifies when a session needs input or
 * finishes) into Crucible, so they arrive as Crucible notifications attributed
 * to the right session instead of being lost.
 *
 * The guest page runs sandboxed with no preload (see claude-web.service), so
 * there is no IPC channel out of it. Instead, on every document load we inject
 * a small shim into the page's main world that replaces `window.Notification`
 * (and `ServiceWorkerRegistration#showNotification`) with a version that
 * reports always-granted permission and, instead of showing anything, logs
 * one marked line to the console. The main process listens to the guest's
 * `console-message` events, picks out the marked lines and hands them on.
 * The page's real notification permission stays denied, so nothing reaches
 * the OS except through Crucible.
 *
 * A page shows notifications about any of the user's cloud sessions (the
 * claude.ai/code sidebar lists them all), so each one carries the cloud
 * session id we could find: in the notification's tag/data/body first, then
 * the URL the page is on. The renderer maps that to a Crucible session.
 */
import type { WebContents } from 'electron'

/** Prefix of the console line the shim logs for each notification. */
export const NOTIFICATION_RELAY_MARKER = '__crucible_web_notification__'

/** Longest title / body we pass on (the rest is cut with an ellipsis). */
const MAX_TITLE = 200
const MAX_BODY = 1000

/** Same notification from several live pages within this window is shown once. */
export const NOTIFICATION_DEDUPE_MS = 5000

/**
 * The script injected into the claude.ai page's main world. Idempotent: a
 * second injection into the same window does nothing.
 */
export const NOTIFICATION_RELAY_SHIM = `(() => {
  if (window.__crucibleNotificationRelay) return;
  Object.defineProperty(window, '__crucibleNotificationRelay', { value: true });
  const MARK = ${JSON.stringify(NOTIFICATION_RELAY_MARKER)};
  const text = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v) || ''; } catch { return ''; }
  };
  const relay = (title, options) => {
    const o = options || {};
    try {
      console.debug(MARK + JSON.stringify({
        title: text(title), body: text(o.body), tag: text(o.tag), data: text(o.data), url: String(location.href),
      }));
    } catch {}
  };
  class RelayedNotification extends EventTarget {
    constructor(title, options) {
      super();
      const o = options || {};
      this.title = text(title);
      this.body = text(o.body);
      this.tag = text(o.tag);
      this.data = o.data ?? null;
      this.icon = text(o.icon);
      this.silent = !!o.silent;
      this.requireInteraction = !!o.requireInteraction;
      this.onclick = null; this.onshow = null; this.onclose = null; this.onerror = null;
      relay(title, o);
      queueMicrotask(() => this._fire('show'));
    }
    _fire(type) {
      const ev = new Event(type);
      this.dispatchEvent(ev);
      const h = this['on' + type];
      if (typeof h === 'function') { try { h.call(this, ev); } catch {} }
    }
    close() { this._fire('close'); }
    static get permission() { return 'granted'; }
    static get maxActions() { return 0; }
    static requestPermission(cb) {
      if (typeof cb === 'function') { try { cb('granted'); } catch {} }
      return Promise.resolve('granted');
    }
  }
  Object.defineProperty(window, 'Notification', { value: RelayedNotification, writable: true, configurable: true });
  if (window.ServiceWorkerRegistration) {
    const proto = window.ServiceWorkerRegistration.prototype;
    proto.showNotification = function (title, options) { relay(title, options); return Promise.resolve(); };
    proto.getNotifications = function () { return Promise.resolve([]); };
  }
  const perms = navigator.permissions;
  if (perms && typeof perms.query === 'function') {
    const query = perms.query.bind(perms);
    perms.query = (desc) => {
      if (desc && desc.name === 'notifications') {
        const status = new EventTarget();
        status.name = 'notifications';
        status.state = 'granted';
        status.onchange = null;
        return Promise.resolve(status);
      }
      return query(desc);
    };
  }
})();`

/** One notification the claude.ai page raised. */
export interface ClaudeWebNotification {
  title: string
  body: string
  /** The cloud session it is about, when we could tell (`session_...`). */
  cloudSessionId: string | null
}

const CLOUD_ID = /\bsession_[A-Za-z0-9]{8,}\b/

/** The first cloud session id in `text`, or null. */
export function findCloudSessionId(text: string | null | undefined): string | null {
  if (!text) return null
  const m = CLOUD_ID.exec(text)
  return m ? m[0] : null
}

const clip = (s: string, max: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

const field = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Parse one console line from the page. Returns null unless it is a marked
 * line from the shim with a title or body.
 */
export function parseRelayedNotification(message: unknown): ClaudeWebNotification | null {
  if (typeof message !== 'string' || !message.startsWith(NOTIFICATION_RELAY_MARKER)) return null
  let raw: Record<string, unknown>
  try {
    const parsed = JSON.parse(message.slice(NOTIFICATION_RELAY_MARKER.length))
    if (!parsed || typeof parsed !== 'object') return null
    raw = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const title = clip(field(raw.title), MAX_TITLE)
  const body = clip(field(raw.body), MAX_BODY)
  if (!title && !body) return null
  // Prefer what the notification itself says it is about; the page's URL is
  // only the session the user last had open in it.
  const cloudSessionId =
    findCloudSessionId(field(raw.tag)) ??
    findCloudSessionId(field(raw.data)) ??
    findCloudSessionId(field(raw.body)) ??
    findCloudSessionId(field(raw.url))
  return { title, body, cloudSessionId }
}

/**
 * Drops repeats: up to 8 live claude.ai pages each see the same notification
 * about a session, and we show it once.
 */
export function createNotificationDeduper(windowMs = NOTIFICATION_DEDUPE_MS, now: () => number = Date.now) {
  const seen = new Map<string, number>()
  return (n: ClaudeWebNotification, fallbackKey: string): boolean => {
    const t = now()
    for (const [k, at] of seen) if (t - at > windowMs) seen.delete(k)
    const key = `${n.cloudSessionId ?? fallbackKey}\u0000${n.title}\u0000${n.body}`
    if (seen.has(key)) return false
    seen.set(key, t)
    return true
  }
}

const isFresh = createNotificationDeduper()

/**
 * Inject the shim into `guest` on every document load and call `onNotify` for
 * each notification the page raises (repeats across pages dropped).
 */
export function installNotificationRelay(
  guest: WebContents,
  onNotify: (notification: ClaudeWebNotification) => void,
): void {
  const inject = (): void => {
    if (guest.isDestroyed()) return
    guest.executeJavaScript(NOTIFICATION_RELAY_SHIM).catch(() => {})
  }
  guest.on('dom-ready', inject)
  // Electron ≤34 passes (event, level, message, …); later versions put the
  // message on the event object.
  guest.on('console-message', ((event: { message?: unknown }, _level: unknown, message: unknown) => {
    const n = parseRelayedNotification(typeof message === 'string' ? message : event?.message)
    if (n && isFresh(n, `guest:${guest.id}`)) onNotify(n)
  }) as never)
}

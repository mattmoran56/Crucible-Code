import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'

/**
 * Process-wide event bus for IPC channel events.
 *
 * The desktop renderer continues to receive events via `webContents.send` —
 * this bus runs in parallel so the embedded relay server (see remote/) can
 * fan the same events out to connected remote receivers.
 *
 * Use `emitToRenderer(window, channel, ...args)` instead of calling
 * `window.webContents.send` directly so both subscribers fire from one call site.
 */
export const eventBus = new EventEmitter()
eventBus.setMaxListeners(50)

/** Send to the local renderer AND notify any bus subscribers (e.g. the relay). */
export function emitToRenderer(
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
  eventBus.emit(channel, ...args)
}

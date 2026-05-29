import type { WebSocket } from 'ws'
import { eventBus } from '../../src/main/services/event-bus'
import { invokeHandler } from '../../src/main/ipc/handle'
import { IPC } from '../../src/shared/constants'
import type { JsonFrame, IPCChannel } from '../protocol/messages'

/**
 * One-per-client bridge. Wires a paired WebSocket to:
 *   - inbound `req` frames -> invokeHandler -> `res` frame
 *   - eventBus events -> outbound `evt` frames
 */
export function attachBridge(ws: WebSocket): () => void {
  const channels: string[] = Object.values(IPC)
  const listeners = new Map<string, (...args: unknown[]) => void>()

  for (const ch of channels) {
    const listener = (...args: unknown[]) => {
      const frame = { kind: 'evt' as const, channel: ch as IPCChannel, args }
      try {
        ws.send(JSON.stringify(frame))
      } catch {
        /* socket closed mid-emit */
      }
    }
    listeners.set(ch, listener)
    eventBus.on(ch, listener)
  }

  ws.on('message', async (raw, isBinary) => {
    if (isBinary) {
      // Binary frames are reserved for the future terminal hot path. Today
      // terminal output already streams as JSON `evt` frames via the eventBus
      // subscription above (channel IPC.TERMINAL_DATA).
      return
    }
    let frame: JsonFrame
    try {
      frame = JSON.parse(raw.toString()) as JsonFrame
    } catch {
      return
    }
    if (frame.kind !== 'req') return
    try {
      const result = await invokeHandler(frame.channel, frame.args)
      ws.send(JSON.stringify({ kind: 'res', id: frame.id, ok: true, result }))
    } catch (err) {
      ws.send(
        JSON.stringify({
          kind: 'res',
          id: frame.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    }
  })

  return () => {
    for (const [ch, listener] of listeners) eventBus.off(ch, listener)
    listeners.clear()
  }
}

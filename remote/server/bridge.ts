import type { WebSocket } from 'ws'
import { eventBus } from '../../src/main/services/event-bus'
import { invokeHandler } from '../../src/main/ipc/handle'
import { IPC } from '../../src/shared/constants'
import type { JsonFrame, IPCChannel } from '../protocol/messages'

/**
 * Transport abstraction the bridge speaks. The LAN relay wraps a `ws.WebSocket`
 * directly; the cloud client wraps an encrypted envelope channel. Both look
 * identical to the bridge — string frames in, string frames out.
 */
export interface Transport {
  send(frame: string): void
  onMessage(cb: (frame: string) => void): void
  onClose(cb: () => void): void
}

function attachToTransport(transport: Transport): () => void {
  const channels: string[] = Object.values(IPC)
  const listeners = new Map<string, (...args: unknown[]) => void>()

  for (const ch of channels) {
    const listener = (...args: unknown[]) => {
      const frame = { kind: 'evt' as const, channel: ch as IPCChannel, args }
      try {
        transport.send(JSON.stringify(frame))
      } catch {
        /* transport closed mid-emit */
      }
    }
    listeners.set(ch, listener)
    eventBus.on(ch, listener)
  }

  const detach = () => {
    for (const [ch, listener] of listeners) eventBus.off(ch, listener)
    listeners.clear()
  }

  transport.onMessage(async (raw) => {
    let frame: JsonFrame
    try {
      frame = JSON.parse(raw) as JsonFrame
    } catch {
      return
    }
    if (frame.kind !== 'req') return
    try {
      const result = await invokeHandler(frame.channel, frame.args)
      transport.send(JSON.stringify({ kind: 'res', id: frame.id, ok: true, result }))
    } catch (err) {
      transport.send(
        JSON.stringify({
          kind: 'res',
          id: frame.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    }
  })

  transport.onClose(detach)

  return detach
}

export function attachBridgeToTransport(transport: Transport): () => void {
  return attachToTransport(transport)
}

/**
 * Convenience wrapper for the existing LAN relay: turn a `ws.WebSocket` into a
 * Transport and attach the bridge. Preserves the original `attachBridge(ws)`
 * call site in `relay-server.ts`.
 */
export function attachBridge(ws: WebSocket): () => void {
  const messageHandlers = new Set<(frame: string) => void>()
  const closeHandlers = new Set<() => void>()

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return // binary path reserved for future hot terminal frames
    const s = raw.toString()
    for (const cb of messageHandlers) cb(s)
  })
  ws.on('close', () => {
    for (const cb of closeHandlers) cb()
  })

  const transport: Transport = {
    send: (frame) => {
      try { ws.send(frame) } catch { /* closed */ }
    },
    onMessage: (cb) => { messageHandlers.add(cb) },
    onClose: (cb) => { closeHandlers.add(cb) },
  }

  return attachToTransport(transport)
}

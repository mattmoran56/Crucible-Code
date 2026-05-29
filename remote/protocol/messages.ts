import type { IPC } from '../../src/shared/constants'

export type IPCChannel = (typeof IPC)[keyof typeof IPC]

export type RequestFrame = {
  kind: 'req'
  id: string
  channel: IPCChannel
  args: unknown[]
}

export type ResponseFrame =
  | { kind: 'res'; id: string; ok: true; result: unknown }
  | { kind: 'res'; id: string; ok: false; error: string }

export type EventFrame = {
  kind: 'evt'
  channel: IPCChannel
  args: unknown[]
}

export type ControlFrame =
  | { kind: 'subscribe-session'; sessionId: string }
  | { kind: 'unsubscribe-session'; sessionId: string }

export type JsonFrame = RequestFrame | ResponseFrame | EventFrame | ControlFrame

export const BINARY_OPCODE = {
  TERMINAL_DATA: 0x01,
  TERMINAL_RESIZE: 0x02,
} as const

export type BinaryOpcode = (typeof BINARY_OPCODE)[keyof typeof BINARY_OPCODE]

/**
 * Binary frame layout:
 *   byte 0           opcode (BINARY_OPCODE)
 *   bytes 1..17      16-byte session+tab UUID (raw bytes, not hex)
 *   bytes 17..21     uint32 BE sequence number (so a reconnect can detect gaps)
 *   bytes 21..       payload
 *     - TERMINAL_DATA: raw PTY bytes
 *     - TERMINAL_RESIZE: { cols: uint16 BE, rows: uint16 BE }
 */
export const BINARY_HEADER_BYTES = 21

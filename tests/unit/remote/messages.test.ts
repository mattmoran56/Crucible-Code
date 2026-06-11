// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  BINARY_OPCODE,
  BINARY_HEADER_BYTES,
  type BinaryOpcode,
  type JsonFrame,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type ControlFrame,
} from '../../../remote/protocol/messages'

/**
 * Encode/decode helpers that follow the documented binary layout:
 *   byte 0       opcode
 *   bytes 1..17  16-byte session+tab UUID (raw bytes)
 *   bytes 17..21 uint32 BE sequence number
 *   bytes 21..   payload
 */
function encodeBinaryFrame(
  opcode: BinaryOpcode,
  uuid: Uint8Array,
  seq: number,
  payload: Uint8Array
): Buffer {
  if (uuid.length !== 16) throw new Error('uuid must be 16 bytes')
  const buf = Buffer.alloc(BINARY_HEADER_BYTES + payload.length)
  buf.writeUInt8(opcode, 0)
  Buffer.from(uuid).copy(buf, 1)
  buf.writeUInt32BE(seq >>> 0, 17)
  Buffer.from(payload).copy(buf, BINARY_HEADER_BYTES)
  return buf
}

function decodeBinaryFrame(buf: Buffer): {
  opcode: number
  uuid: Uint8Array
  seq: number
  payload: Uint8Array
} {
  return {
    opcode: buf.readUInt8(0),
    uuid: new Uint8Array(buf.subarray(1, 17)),
    seq: buf.readUInt32BE(17),
    payload: new Uint8Array(buf.subarray(BINARY_HEADER_BYTES)),
  }
}

const UUID = new Uint8Array(Array.from({ length: 16 }, (_, i) => i * 13 + 1).map((n) => n & 0xff))

describe('remote/protocol/messages binary constants', () => {
  it('TERMINAL_DATA opcode is 0x01', () => {
    expect(BINARY_OPCODE.TERMINAL_DATA).toBe(0x01)
  })

  it('TERMINAL_RESIZE opcode is 0x02', () => {
    expect(BINARY_OPCODE.TERMINAL_RESIZE).toBe(0x02)
  })

  it('opcodes are distinct single-byte values', () => {
    const values = Object.values(BINARY_OPCODE)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xff)
    }
  })

  it('BINARY_HEADER_BYTES matches the documented layout (1 + 16 + 4)', () => {
    expect(BINARY_HEADER_BYTES).toBe(21)
    expect(BINARY_HEADER_BYTES).toBe(1 + 16 + 4)
  })
})

describe('remote/protocol/messages binary frame layout', () => {
  it('round-trips a TERMINAL_DATA frame with raw PTY payload', () => {
    const payload = new TextEncoder().encode('ls -la\r\n')
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_DATA, UUID, 7, payload)
    const out = decodeBinaryFrame(buf)
    expect(out.opcode).toBe(BINARY_OPCODE.TERMINAL_DATA)
    expect(Array.from(out.uuid)).toEqual(Array.from(UUID))
    expect(out.seq).toBe(7)
    expect(new TextDecoder().decode(out.payload)).toBe('ls -la\r\n')
  })

  it('round-trips a TERMINAL_RESIZE frame carrying cols/rows as uint16 BE', () => {
    const resize = Buffer.alloc(4)
    resize.writeUInt16BE(120, 0)
    resize.writeUInt16BE(40, 2)
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_RESIZE, UUID, 1, new Uint8Array(resize))
    const out = decodeBinaryFrame(buf)
    expect(out.opcode).toBe(BINARY_OPCODE.TERMINAL_RESIZE)
    const view = Buffer.from(out.payload)
    expect(view.readUInt16BE(0)).toBe(120)
    expect(view.readUInt16BE(2)).toBe(40)
  })

  it('a header-only frame is exactly BINARY_HEADER_BYTES long with empty payload', () => {
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_DATA, UUID, 0, new Uint8Array(0))
    expect(buf.length).toBe(BINARY_HEADER_BYTES)
    expect(decodeBinaryFrame(buf).payload).toHaveLength(0)
  })

  it('sequence number survives the full uint32 range (gap detection on reconnect)', () => {
    for (const seq of [0, 1, 65535, 2 ** 31 - 1, 2 ** 32 - 1]) {
      const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_DATA, UUID, seq, new Uint8Array(0))
      expect(decodeBinaryFrame(buf).seq).toBe(seq)
    }
  })

  it('sequence number is big-endian on the wire', () => {
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_DATA, UUID, 0x01020304, new Uint8Array(0))
    expect(Array.from(buf.subarray(17, 21))).toEqual([0x01, 0x02, 0x03, 0x04])
  })

  it('uuid bytes occupy bytes 1..17 untouched by opcode or seq', () => {
    const uuid = new Uint8Array(16).fill(0xab)
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_RESIZE, uuid, 0xffffffff, new Uint8Array([1]))
    expect(Array.from(buf.subarray(1, 17))).toEqual(Array(16).fill(0xab))
    expect(buf.readUInt8(0)).toBe(BINARY_OPCODE.TERMINAL_RESIZE)
  })

  it('binary payload bytes pass through verbatim including zero and 0xff', () => {
    const payload = new Uint8Array([0, 255, 128, 1, 0, 0xfe])
    const buf = encodeBinaryFrame(BINARY_OPCODE.TERMINAL_DATA, UUID, 3, payload)
    expect(Array.from(decodeBinaryFrame(buf).payload)).toEqual(Array.from(payload))
  })
})

describe('remote/protocol/messages JSON frames', () => {
  function roundTrip<T extends JsonFrame>(frame: T): T {
    return JSON.parse(JSON.stringify(frame)) as T
  }

  it('round-trips a request frame with args intact', () => {
    const req: RequestFrame = {
      kind: 'req',
      id: 'r-1',
      channel: 'project:list',
      args: [{ nested: true }, 42, null, 'x'],
    }
    const out = roundTrip(req)
    expect(out).toEqual(req)
    expect(out.kind).toBe('req')
  })

  it('round-trips a successful response frame', () => {
    const res: ResponseFrame = { kind: 'res', id: 'r-1', ok: true, result: { items: [1, 2] } }
    const out = roundTrip(res)
    expect(out).toEqual(res)
    if (out.ok) expect(out.result).toEqual({ items: [1, 2] })
  })

  it('round-trips an error response frame preserving the error string', () => {
    const res: ResponseFrame = { kind: 'res', id: 'r-2', ok: false, error: 'boom: not found' }
    const out = roundTrip(res)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('boom: not found')
  })

  it('round-trips an event frame', () => {
    const evt: EventFrame = { kind: 'evt', channel: 'terminal:data', args: ['tab-1', 'output'] }
    expect(roundTrip(evt)).toEqual(evt)
  })

  it('round-trips subscribe/unsubscribe control frames', () => {
    const sub: ControlFrame = { kind: 'subscribe-session', sessionId: 's-9' }
    const unsub: ControlFrame = { kind: 'unsubscribe-session', sessionId: 's-9' }
    expect(roundTrip(sub)).toEqual(sub)
    expect(roundTrip(unsub)).toEqual(unsub)
  })

  it('kind discriminant distinguishes all frame variants after parsing', () => {
    const frames: JsonFrame[] = [
      { kind: 'req', id: '1', channel: 'git:status', args: [] },
      { kind: 'res', id: '1', ok: true, result: null },
      { kind: 'evt', channel: 'file:changed', args: [] },
      { kind: 'subscribe-session', sessionId: 'a' },
      { kind: 'unsubscribe-session', sessionId: 'a' },
    ]
    const kinds = frames.map((f) => (JSON.parse(JSON.stringify(f)) as JsonFrame).kind)
    expect(kinds).toEqual(['req', 'res', 'evt', 'subscribe-session', 'unsubscribe-session'])
    expect(new Set(kinds).size).toBe(5) // req/res/evt + 2 control kinds, all distinct
  })
})

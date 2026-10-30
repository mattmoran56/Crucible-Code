import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ default: {}, clipboard: { has: vi.fn() } }))

import { isDictatedClipboard } from '../../../src/main/services/dictation.service'

describe('isDictatedClipboard', () => {
  it('is a dictation paste when the clipboard is marked concealed (Wispr Flow)', () => {
    expect(isDictatedClipboard((f) => f === 'org.nspasteboard.ConcealedType')).toBe(true)
  })

  it('is a dictation paste when the clipboard is marked transient', () => {
    expect(isDictatedClipboard((f) => f === 'org.nspasteboard.TransientType')).toBe(true)
  })

  it('a clipboard you copied yourself carries no mark', () => {
    expect(isDictatedClipboard(() => false)).toBe(false)
  })

  it('a clipboard that cannot be read is not a dictation paste', () => {
    expect(
      isDictatedClipboard(() => {
        throw new Error('unsupported')
      }),
    ).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generatePairingCode,
  currentPairingCode,
  consumePairingCode,
  clearPairingCode,
  setPairingMode,
} from '../../../remote/server/pairing'

describe('remote/server/pairing', () => {
  beforeEach(() => {
    setPairingMode('code')
    clearPairingCode()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    clearPairingCode()
    setPairingMode('qr')
  })

  it('generates a 6-character base32-style code in code mode', () => {
    const code = generatePairingCode()
    expect(code).toHaveLength(6)
    expect(code).toMatch(/^[A-Z2-9]+$/)
    // confusables explicitly stripped from the alphabet
    expect(code).not.toMatch(/[01OI]/)
  })

  it('generates a 52-character high-entropy secret in QR mode', () => {
    setPairingMode('qr')
    const code = generatePairingCode()
    expect(code).toHaveLength(52)
    expect(code).toMatch(/^[A-Z2-9]+$/)
  })

  it('exposes the active code via currentPairingCode until consumed or expired', () => {
    const code = generatePairingCode()
    expect(currentPairingCode()).toBe(code)
  })

  it('consumePairingCode succeeds once with the right code and not again', () => {
    const code = generatePairingCode()
    expect(consumePairingCode(code)).toBe(true)
    expect(consumePairingCode(code)).toBe(false)
    expect(currentPairingCode()).toBeNull()
  })

  it('consumePairingCode is case-insensitive and ignores whitespace', () => {
    const code = generatePairingCode()
    expect(consumePairingCode(`  ${code.toLowerCase()}  `)).toBe(true)
  })

  it('consumePairingCode rejects the wrong code', () => {
    generatePairingCode()
    expect(consumePairingCode('WRONG1')).toBe(false)
    expect(currentPairingCode()).not.toBeNull()
  })

  it('expires after 5 minutes', () => {
    generatePairingCode()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(currentPairingCode()).toBeNull()
  })

  it('regenerating supersedes the previous code', () => {
    const first = generatePairingCode()
    const second = generatePairingCode()
    expect(second).not.toBe(first) // overwhelmingly probable
    expect(consumePairingCode(first)).toBe(false)
    expect(consumePairingCode(second)).toBe(true)
  })
})

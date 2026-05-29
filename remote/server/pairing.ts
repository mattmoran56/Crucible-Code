import { randomBytes } from 'node:crypto'

const PAIR_TTL_MS = 5 * 60 * 1000

interface PairingCode {
  code: string
  expiresAt: number
}

let active: PairingCode | null = null

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // base32 sans confusables

let onChange: (() => void) | null = null

/** Cloud client subscribes once at startup so its ticket follows the code. */
export function setOnPairingCodeChange(cb: () => void): void {
  onChange = cb
}

export function generatePairingCode(): string {
  const bytes = randomBytes(6)
  let code = ''
  for (let i = 0; i < 6; i++) code += ALPHABET[bytes[i] % ALPHABET.length]
  active = { code, expiresAt: Date.now() + PAIR_TTL_MS }
  onChange?.()
  return code
}

export function currentPairingCode(): string | null {
  if (!active) return null
  if (Date.now() > active.expiresAt) {
    active = null
    return null
  }
  return active.code
}

export function consumePairingCode(submitted: string): boolean {
  if (!active) return false
  if (Date.now() > active.expiresAt) {
    active = null
    return false
  }
  if (submitted.toUpperCase().trim() !== active.code) return false
  active = null // single-use
  return true
}

export function clearPairingCode(): void {
  active = null
}

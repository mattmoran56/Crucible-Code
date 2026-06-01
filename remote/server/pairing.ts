import { randomBytes } from 'node:crypto'
import Store from 'electron-store'

const PAIR_TTL_MS = 5 * 60 * 1000

interface PairingCode {
  code: string
  expiresAt: number
}

let active: PairingCode | null = null

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // base32 sans confusables

// QR mode encodes the secret in a scannable QR, so we don't need it to be
// human-typeable. Use 32 bytes of entropy (≈52 base32 chars) — orders of
// magnitude larger than the 6-char fallback.
const QR_LEN = 52
const CODE_LEN = 6

export type PairingMode = 'qr' | 'code'

const modeStore = new Store<{ pairingMode: PairingMode }>({
  name: 'remote-pairing-mode',
  defaults: { pairingMode: 'qr' },
})

export function getPairingMode(): PairingMode {
  return modeStore.get('pairingMode', 'qr')
}

export function setPairingMode(mode: PairingMode): void {
  modeStore.set('pairingMode', mode)
  // Mint a fresh secret in the new mode so the displayed value matches.
  generatePairingCode()
}

let onChange: (() => void) | null = null

/** Cloud client subscribes once at startup so its ticket follows the code. */
export function setOnPairingCodeChange(cb: () => void): void {
  onChange = cb
}

export function generatePairingCode(): string {
  const len = getPairingMode() === 'qr' ? QR_LEN : CODE_LEN
  const bytes = randomBytes(len)
  let code = ''
  for (let i = 0; i < len; i++) code += ALPHABET[bytes[i] % ALPHABET.length]
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

/**
 * Envelope frames exchanged through the hosted relay.
 *
 * The relay forwards these as opaque JSON; only the two endpoints inspect
 * `kind`. The pairing code itself is **never** sent through the relay — it's
 * mixed into the HKDF salt on both sides, so a wrong code → mismatched keys →
 * decrypt fails. This means the relay cannot phish the code from logs.
 *
 *   - `hello`     : phone announces its X25519 pubkey + a friendly label
 *   - `hello-ack` : desktop replies with its pubkey + a 6-digit safety number
 *                   derived from the shared key, so the user can visually
 *                   confirm there's no MITM
 *   - `data`      : XChaCha20-Poly1305 sealed JsonFrame
 *   - `peer-gone` / `peer-absent` : emitted *by the relay*, never by clients
 */

export type CloudHello = {
  kind: 'hello'
  pubkey: string // base64 X25519 pubkey
  label: string
  // 'pair' on first contact (salt = pairing code typed by user);
  // 'token' on reconnect (salt = previously-issued bearer token).
  mode: 'pair' | 'token'
  // First 8 chars of the bearer token, used by the desktop to look up the
  // matching full token for HKDF salt. Only present when mode='token'.
  tokenId?: string
}

export type CloudHelloAck = {
  kind: 'hello-ack'
  pubkey: string // base64 X25519 pubkey
  safetyNumber: string // 6 digits, displayed on both ends
}

export type CloudData = {
  kind: 'data'
  nonce: string // base64 24-byte XChaCha20 nonce
  payload: string // base64 ciphertext
}

export type CloudRelayNotice =
  | { kind: 'peer-gone' }
  | { kind: 'peer-absent' }
  | { kind: 'peer-arrived' }

export type CloudEnvelope = CloudHello | CloudHelloAck | CloudData | CloudRelayNotice

/**
 * Inside a `data` envelope, the plaintext is a JSON object that is either:
 *   - a `JsonFrame` (req/res/evt/control) — same as today's LAN protocol; or
 *   - one of the cloud-only auth frames below, which gate access before any
 *     regular IPC is processed.
 *
 * The first frame sent by the phone after key exchange MUST be `auth-req`
 * carrying the pairing code (mixed into the encrypted payload, so the relay
 * never sees it). Desktop validates with `consumePairingCode()` and replies
 * with `auth-res` carrying a bearer token the phone uses on reconnect.
 */
export type CloudAuthReq =
  // First-time pair: code is mixed into HKDF salt, not sent here. The mere
  // fact that this frame decrypts proves the phone has the code.
  | { kind: 'auth-req'; mode: 'pair'; label: string }
  // Reconnect: phone presents a previously-issued bearer token.
  | { kind: 'auth-req'; mode: 'token'; token: string; label: string }
export type CloudAuthRes =
  | { kind: 'auth-res'; ok: true; token: string }
  | { kind: 'auth-res'; ok: false; error: string }

export type CloudInner = CloudAuthReq | CloudAuthRes

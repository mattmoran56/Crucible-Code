/**
 * libsodium-wrappers helpers shared by desktop (Node) and receiver (browser).
 *
 * - X25519 ephemeral key exchange
 * - HKDF-SHA256 over the shared secret, salted with the pairing code (first
 *   pair) or the bearer token (reconnect), so a wrong code → wrong key →
 *   decrypt fails. The relay can't substitute keys without knowing the salt.
 * - XChaCha20-Poly1305 sealed boxes for every IPC frame
 * - A short "safety number" derived from the shared key so the user can
 *   visually confirm both ends match (active-MITM defence)
 */

import sodium from 'libsodium-wrappers'

let ready: Promise<void> | null = null
function init(): Promise<void> {
  if (!ready) ready = sodium.ready
  return ready
}

export interface KeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export async function generateKeypair(): Promise<KeyPair> {
  await init()
  const kp = sodium.crypto_kx_keypair()
  return { publicKey: kp.publicKey, privateKey: kp.privateKey }
}

export async function deriveSharedKey(
  myPrivate: Uint8Array,
  theirPublic: Uint8Array,
  salt: string
): Promise<Uint8Array> {
  await init()
  // X25519 ECDH for the raw shared secret.
  const ecdh = sodium.crypto_scalarmult(myPrivate, theirPublic)
  // libsodium-wrappers doesn't expose HKDF-SHA256, so we use BLAKE2b as a KDF:
  // out = BLAKE2b-256(ecdh || salt || info). Mixing the salt (pairing code or
  // bearer token) and a domain-separation tag into the hash binds the key to
  // the auth context with the same anti-substitution property HKDF provides.
  const saltInfo = sodium.from_string(`${salt}|cc-remote-v1`)
  const input = new Uint8Array(ecdh.length + saltInfo.length)
  input.set(ecdh, 0)
  input.set(saltInfo, ecdh.length)
  return sodium.crypto_generichash(32, input, null)
}

export async function seal(
  key: Uint8Array,
  plaintext: Uint8Array | string
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  await init()
  const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  const pt: Uint8Array =
    typeof plaintext === 'string' ? sodium.from_string(plaintext) : plaintext
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    pt,
    null,
    null,
    nonce,
    key
  ) as Uint8Array
  return { nonce, ciphertext }
}

export async function open(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  await init()
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, key)
}

/**
 * 6-digit safety number derived deterministically from the shared key.
 * Both sides will compute the same string if no MITM occurred.
 */
export async function safetyNumber(key: Uint8Array): Promise<string> {
  await init()
  const hash = sodium.crypto_generichash(8, key, null)
  let n = 0n
  for (const b of hash) n = (n << 8n) | BigInt(b)
  const six = Number(n % 1_000_000n).toString().padStart(6, '0')
  return `${six.slice(0, 3)} ${six.slice(3)}`
}

// Base64 helpers — used everywhere we shuttle bytes through JSON envelopes.
export async function b64encode(bytes: Uint8Array): Promise<string> {
  await init()
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL)
}

export async function b64decode(s: string): Promise<Uint8Array> {
  await init()
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL)
}

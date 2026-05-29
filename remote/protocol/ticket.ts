/**
 * Phone ticket derivation. Used as a relay-layer credential on /phone so an
 * attacker who only knows the handle can't connect and squat the phone slot.
 *
 * Both desktop and phone derive ticket = sha256(handle + ":" + code) hex.
 * The phone types the pairing code, the desktop has it from `pairing.ts` —
 * neither side needs an extra user-visible field.
 *
 * Trade-off: when the desktop user regenerates the pairing code, the ticket
 * stored in the Worker's DO also rotates, so any already-paired phone with
 * the stale ticket gets a 401 on /phone and is forced to re-enter the new
 * code. Regenerating the code is a deliberate security action and locking
 * out old phones is the right behaviour there.
 */

export async function deriveTicket(handle: string, code: string): Promise<string> {
  const enc = new TextEncoder().encode(`${handle.toLowerCase()}:${code.toUpperCase()}`)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const bytes = new Uint8Array(digest)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

# Cloud relay

Deep-dive on the hosted relay mode (Cloudflare Worker + Durable Objects) that lets a phone drive a desktop CodeCrucible instance from outside the LAN — through VPN, cellular, or hotel Wi-Fi — without trusting the relay with any plaintext.

The LAN mode is documented in [REMOTE.md](REMOTE.md). The relay code lives in [`../relay-worker/`](../relay-worker/README.md). Frame types are defined in [`../remote/protocol/cloud.ts`](../remote/protocol/cloud.ts) and the crypto helpers in [`../remote/protocol/e2e.ts`](../remote/protocol/e2e.ts).

## Architecture

```
                                Cloudflare
   ┌─────────────┐   WSS    ┌──────────────────┐    WSS   ┌───────────┐
   │  Desktop    │ ───────► │  Worker          │ ◄─────── │  Phone    │
   │ (Electron)  │  /desktop│   ↓ idFromName   │   /phone │ (browser/ │
   │             │ ◄─────── │  Room DO[handle] │ ───────► │  PWA)     │
   └─────────────┘          │   • token        │          └───────────┘
        ▲                   │   • phoneTicket  │                ▲
        │                   │   • sockets×2    │                │
        │                   │   • 30d alarm    │                │
        │                   └──────────────────┘                │
        │                                                       │
        │           libsodium end-to-end envelope               │
        └───────────────────────────────────────────────────────┘
              X25519 + HKDF(salt=pairing-code|token) +
              XChaCha20-Poly1305 on every frame
```

Every frame on the wire is a `CloudEnvelope` (JSON). The relay inspects only the envelope `kind` for routing and bookkeeping; the `data` envelopes are opaque ciphertext.

## Frame protocol

Defined in [`remote/protocol/cloud.ts`](../remote/protocol/cloud.ts). Outer envelopes:

| envelope | direction | purpose |
|---|---|---|
| `hello` | phone → desktop | X25519 pubkey + friendly label + `mode` ('pair' on first contact, 'token' on reconnect). Carries `tokenId` (first 8 chars) so the desktop can look up the full token used as HKDF salt. |
| `hello-ack` | desktop → phone | X25519 pubkey + 6-digit safety number derived from the shared key. Displayed on both ends for visual MITM check. |
| `data` | both | XChaCha20-Poly1305 sealed `JsonFrame` or `CloudInner` (24-byte nonce + ciphertext, both base64). |
| `peer-absent` / `peer-arrived` / `peer-gone` | relay → client | Connection bookkeeping. Emitted by the Room DO only after authentication has already passed, so they don't leak handle existence. |

Inside `data`, after key exchange, the phone's first plaintext is a `CloudInner`:

- `auth-req` `mode: 'pair'` — the *fact that this frame decrypts* proves the phone knows the pairing code (it's mixed into the HKDF salt, never sent on the wire).
- `auth-req` `mode: 'token'` — reconnect; phone presents a previously-issued bearer token (also mixed into the salt).
- `auth-res` — desktop replies with a fresh long-lived bearer token (success) or an error.

After `auth-res ok: true`, the inner channel reverts to the standard `JsonFrame` (`req` / `res` / `evt` / `control`) that the LAN mode and the desktop renderer already speak. The relay never distinguishes auth frames from regular IPC — they're all `data`.

## Auth state

Two parallel auth states, rotated at different cadences:

| state | held by | rotates when | role |
|---|---|---|---|
| **Relay token** (32-byte hex) | Room DO + desktop (env / keychain) | Only on `/register` (initial claim or explicit rotation with `currentToken`). 30-day idle TTL. | Lets the desktop open `/desktop` WS and call `/set-phone-ticket` / `/unregister`. |
| **Phone ticket** = `sha256(handle:pairing-code)` | Room DO + computed by phone | Whenever the desktop regenerates the pairing code, or on token rotation. | Lets the phone open `/phone` WS. Bounded entropy from the 6-char code — that's why `/phone` is rate limited. |
| **E2E bearer token** (in-band) | Desktop session store + phone `localStorage` | On every successful first-pair. Never sent to the relay. | Reconnect HKDF salt, so reconnect doesn't burn another pairing code. |

The pairing code itself is **never sent through the relay**. It's typed by the user on the phone, mixed into the HKDF salt, and validated implicitly by whether the encrypted `auth-req` decrypts on the desktop.

## Threat model

### What the relay can do

- Observe handle existence, connection metadata (IPs, timing, frame sizes).
- Drop, reorder, or replay envelopes (decrypt will fail on tampered payloads; replays of `data` frames fail the AEAD nonce uniqueness check on the receiving end).
- Refuse service to specific handles or IPs.

### What the relay cannot do

- Read or modify IPC payloads, terminal output, file contents, prompts, or anything inside `data` envelopes.
- Learn the pairing code or the e2e bearer token.
- Impersonate either side without breaking X25519 (visible to the user as a different 6-digit safety number).
- Enumerate registered handles (KV-gated; unknown handle and bad ticket both return identical 401).
- Substitute its own X25519 key undetectably — the safety number would diverge.

### Attacks closed by each layer

| attack | closed by |
|---|---|
| Passive sniffing of IPC / terminals | XChaCha20-Poly1305 e2e on every frame |
| Active MITM swapping X25519 keys | 6-digit safety number displayed on both ends |
| Phishing the pairing code via the relay | Code is never transmitted — only mixed into HKDF salt |
| Replay of captured `data` frames | AEAD nonce uniqueness + session-scoped keys |
| Brute force of the 6-char derived phone ticket | `PHONE_RL` 20/min/IP + optional desktop approval gate |
| Brute force of `/register` to claim handles | `REGISTER_RL` 5/min/IP + 32-byte tokens for rotation |
| Handle enumeration via timing on `/phone` | KV-gated room spawn + identical 401 across all reject paths |
| Slot hijack (second device on existing handle) | `/register` on an existing handle requires `currentToken`; phone-side reconnect requires the e2e bearer token |
| Permanent handle squatting | 30-day idle alarm wipes the Room DO and KV entry; explicit `/unregister` runs the same purge |
| Stolen token long-tail | `/unregister` + handle rotation force a clean re-pair |
| Coercion to approve a malicious pairing | Approval gate shows the phone's self-declared label + safety number for visual confirmation before granting access |

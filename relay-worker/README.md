# Crucible Code relay — Cloudflare Workers

Hosted at **`https://codecrucible-relay.mattmoran56.workers.dev`**. Port of the original Node `relay-backend/` to Cloudflare Workers + Durable Objects.

- One **`Room` Durable Object instance per handle** (`idFromName(handle)`), holding the desktop + phone WebSockets via the hibernatable WS API. Idle rooms cost nothing.
- The Worker is stateless — it just routes HTTP and WS upgrades into the right Room DO.
- The receiver SPA is served from the assets binding (`./public/`).
- Forwards opaque ciphertext only; libsodium end-to-end crypto runs in the desktop and phone clients (see [`../docs/cloud-relay.md`](../docs/cloud-relay.md)).

## Endpoints

| method | path | purpose |
|---|---|---|
| `POST` | `/register` | Claim a handle. Returns a 32-byte bearer token. Optional `currentToken` rotates an existing handle (and force-clears its phone ticket). Rate limited via `REGISTER_RL` (5/min/IP). |
| `POST` | `/unregister` | Drop the room and its KV entry. Requires the current bearer token. |
| `POST` | `/set-phone-ticket` | Desktop deposits `sha256(handle:pairing-code)` so the relay can authenticate the phone without ever seeing the pairing code. |
| `GET`  | `/desktop?handle=…&token=…` | Desktop WebSocket upgrade. |
| `GET`  | `/phone?handle=…&ticket=…` | Phone WebSocket upgrade. Rate limited via `PHONE_RL` (20/min/IP). |
| `GET`  | `/health` | Liveness probe. |
| `GET`  | `/` (and anything else) | Receiver SPA from the `ASSETS` binding. |

All reject paths on `/phone` (unknown handle, missing ticket, wrong ticket, no ticket set) return an identical `401 unauthorized` so the relay can't be used to enumerate handles or probe pairing state.

## Bindings

| binding | kind | notes |
|---|---|---|
| `ROOM` | Durable Object namespace | One DO per handle; SQLite-backed storage for token, phone ticket, last-desktop-connect timestamp. |
| `HANDLE_REGISTRY` | KV namespace | Existence marker per registered handle. Gates DO spawning so unknown handles cost nothing and can't be probed. TTL slightly longer than the token TTL. |
| `REGISTER_RL` | Workers Rate Limiting | 5 requests / 60 s / IP on `/register`. |
| `PHONE_RL` | Workers Rate Limiting | 20 requests / 60 s / IP on `/phone` — keeps brute-force of the 6-char-derived ticket impractical. |
| `ASSETS` | static-assets binding | Serves `./public/` (built receiver SPA). |

## Lifecycle

- `/register` writes the token to DO storage and a marker to KV, then schedules a 30-day alarm.
- Every desktop reconnect bumps `lastDesktopConnect` and re-schedules the alarm.
- If 30 days pass with no desktop activity, the alarm fires `purge()`: sockets closed, DO storage wiped, KV entry dropped. Handles can't be permanently squatted.
- `/unregister` runs the same purge immediately.
- Rotating a handle via `/register` with `currentToken` mints a fresh token **and** clears the phone ticket, forcing the phone to re-pair.

## Differences from the Node backend

| concern | Node | Worker |
|---|---|---|
| state | in-memory `Map<handle, Room>` | Durable Object per handle, SQLite-backed |
| handle TTL | dropped on restart | persisted, 30-day idle TTL via DO alarm |
| rate limit | per-IP token bucket in process | Workers Rate Limiting bindings (`REGISTER_RL`, `PHONE_RL`) |
| static SPA | `fs.createReadStream` | `[assets]` binding |
| handle enumeration | possible via timing on `/phone` | KV-gated; unknown handle and bad ticket return identical 401 |

## Deploy

```bash
cd relay-worker
npm install
# Drop the receiver build into ./public
(cd ../remote/receiver && npm run build)
rm -rf public && cp -r ../remote/receiver/dist public
npx wrangler deploy
```

To point a custom hostname at it (e.g. `relay.codecrucible.app`), add a route in `wrangler.toml`:

```toml
routes = [
  { pattern = "relay.codecrucible.app/*", custom_domain = true }
]
```

## Local dev

```bash
npm run dev
```

Wrangler binds to `:9000` (matches the Node backend dev port), so the desktop app can keep using `RELAY_BACKEND_URL=http://localhost:9000`.

## Pointing the desktop at a self-hosted instance

Set `RELAY_BACKEND_URL=https://your-worker.example.workers.dev` in the desktop env before launch. The receiver SPA URL the phone visits is just the same origin.

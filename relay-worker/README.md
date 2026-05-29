# Crucible Code relay — Cloudflare Workers

Port of `relay-backend/` to Cloudflare Workers + Durable Objects.

- One **`Room` Durable Object instance per handle** (`idFromName(handle)`), holding the desktop + phone WebSockets via the hibernatable WS API. Idle rooms cost nothing.
- The Worker is stateless — it just routes `/register`, `/desktop`, `/phone` into the right Room DO.
- The receiver SPA is served from the assets binding (`./public/`).

## Differences from the Node backend

| concern | Node | Worker |
|---|---|---|
| state | in-memory `Map<handle, Room>` | Durable Object per handle, SQLite-backed |
| handle TTL | dropped on restart | persisted indefinitely (idempotent re-register fails with 409 — by design) |
| rate limit | per-IP token bucket | use zone-level Cloudflare rate-limiting rule (TODO) |
| static SPA | `fs.createReadStream` | `[assets]` binding |

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

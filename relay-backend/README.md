# Crucible Code relay backend

Stateless WebSocket relay that connects a Crucible Code desktop instance to a phone receiver when the two cannot reach each other directly (e.g. desktop is on a VPN). Forwards opaque, end-to-end-encrypted frames between the two sides; the backend never sees plaintext IPC.

## Endpoints

- `POST /register` — desktop claims a handle, receives a long-lived bearer token. Rate-limited per IP.
- `GET /desktop?handle=...&token=...` — Upgrade. Desktop holds the room.
- `GET /phone?handle=...` — Upgrade. Phone joins the room.
- `GET /health` — liveness probe.
- `GET /*` — serves the receiver SPA from `public/` if present.

Rooms live in memory. Restart drops all sessions.

## Local dev

```bash
cd relay-backend
npm install
npm run dev
```

Default port `9000`. Override with `PORT` env.

On the desktop side, set `RELAY_BACKEND_URL=ws://localhost:9000` (or the HTTPS/WSS equivalent in production) before launching the Electron app.

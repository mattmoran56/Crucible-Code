# remote/

Embedded LAN relay server + browser receiver app for the Remote Connection feature.

## Layout

- `protocol/` — shared TypeScript types (WebSocket frame union, channel re-exports). Imported by both the Electron main process (`src/main/...`) and the receiver Vite app.
- `server/` — runs inside the Electron main process. HTTP server that (a) serves the built receiver app and (b) accepts WebSocket connections from paired browsers.
- `receiver/` — standalone Vite + React app the remote browser loads. Talks to `server/` over a single WebSocket, presents a `window.api`-style shim, and renders projects / sessions / settings / a live session terminal.

## How it fits together

1. Renderer top-bar `<RemoteTogglePopover>` calls `window.api.remote.setEnabled(true)`, which boots `relay-server.ts` on `0.0.0.0:7878` and generates a 6-char pairing code shown to the user.
2. The remote browser loads the LAN URL → static-served `receiver/dist/index.html` → `PairingPage` POSTs the code to `/pair` and stores the returned token in `localStorage`.
3. Receiver opens `ws://host:7878/ws?token=…`. `bridge.ts` attaches one bridge per socket:
   - Inbound `req` frames are dispatched through `src/main/ipc/handle.ts#invokeHandler`, the same handler map the local renderer uses via `ipcMain.handle`.
   - Outbound: every event broadcast via `src/main/services/event-bus.ts` is forwarded as an `evt` frame. The event bus is fed automatically by a monkey-patch on `mainWindow.webContents.send` in `src/main/index.ts`, so all existing call sites work unchanged.
4. Receiver pages call the `api` proxy in `src/api/wsClient.ts` (e.g. `api.projects.list()` → `wsClient.invoke(IPC.PROJECT_LIST, [])`). The session page mounts xterm.js, spawns a remote PTY via `IPC.TERMINAL_SPAWN`, and streams data over the existing `IPC.TERMINAL_DATA` event channel.

## Status (v1)

Implemented:
- Embedded HTTP + WebSocket server with pairing code, token issue/verify, per-device list.
- Renderer top-bar toggle + popover (regenerate code, revoke all, paired devices).
- Receiver app: pair page, projects list, project detail (sessions + Notion toggle), session terminal view with bidirectional I/O and resize.
- Notion config save fans out via the event bus so a remote toggle propagates to the desktop UI without manual reload.

Deferred (v2):
- Binary framing + ring buffer + node-pty pause/resume on backpressure. Today terminal output streams as JSON `evt` frames, which works on a healthy LAN but loses bytes across a WebSocket reconnect. Plan and protocol headers (`BINARY_OPCODE`, `BINARY_HEADER_BYTES`) are scaffolded in `protocol/messages.ts`.
- Pull requests, Claude-for-Web flows, env-var sync, repo cloning to the remote machine — all explicitly out of v1 per the approved plan.

## Local testing

```sh
npm install                     # installs ws + @types/ws at the repo root
npm run build                   # builds main + renderer
cd remote/receiver
npm install && npm run build    # builds receiver/dist
cd ../..
npm run dev                     # start the desktop app, toggle Remote in the top bar
```

Then open the LAN URL shown in the popover from another device, enter the pairing code, and your projects / sessions appear.

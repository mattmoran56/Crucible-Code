import type { JsonFrame, IPCChannel } from '@protocol/messages'
import { IPC } from '@protocol/channels'
import {
  detectCloudMode,
  openCloudConnection,
  getStoredHandle,
  getCloudToken,
  clearStoredHandle,
  setStoredTicket,
  type CloudConnection,
} from './cloud'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

const STORAGE_TOKEN_KEY = 'codecrucible-remote-token'

type Mode = 'lan' | 'cloud'

class WsClient {
  private ws: WebSocket | null = null
  private cloud: CloudConnection | null = null
  private mode: Mode = 'lan'
  private cloudSafetyNumber: string | null = null
  private nextId = 1
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  private connectedListeners = new Set<(connected: boolean) => void>()
  private safetyListeners = new Set<(s: string | null) => void>()
  private connected = false
  private reconnectTimer: number | null = null

  async detectMode(): Promise<Mode> {
    this.mode = (await detectCloudMode()) ? 'cloud' : 'lan'
    return this.mode
  }

  getMode(): Mode {
    return this.mode
  }

  getSafetyNumber(): string | null {
    return this.cloudSafetyNumber
  }

  onSafetyNumber(cb: (s: string | null) => void): () => void {
    this.safetyListeners.add(cb)
    cb(this.cloudSafetyNumber)
    return () => this.safetyListeners.delete(cb)
  }

  private setSafetyNumber(s: string | null): void {
    this.cloudSafetyNumber = s
    this.safetyListeners.forEach((cb) => cb(s))
  }

  getToken(): string | null {
    return localStorage.getItem(STORAGE_TOKEN_KEY)
  }

  setToken(token: string): void {
    localStorage.setItem(STORAGE_TOKEN_KEY, token)
  }

  clearToken(): void {
    localStorage.removeItem(STORAGE_TOKEN_KEY)
  }

  isConnected(): boolean {
    return this.connected
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectedListeners.add(cb)
    cb(this.connected)
    return () => this.connectedListeners.delete(cb)
  }

  connect(): void {
    if (this.mode === 'cloud') {
      void this.connectCloud()
      return
    }
    const token = this.getToken()
    if (!token) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING))
      return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'

    this.ws.onopen = () => this.setConnected(true)
    this.ws.onclose = () => {
      this.setConnected(false)
      this.scheduleReconnect()
    }
    this.ws.onerror = () => {
      this.ws?.close()
    }
    this.ws.onmessage = (ev) => this.onMessage(ev.data)
  }

  private async connectCloud(code?: string): Promise<void> {
    const handle = getStoredHandle()
    if (!handle) return
    if (this.cloud) return
    const label = navigator.userAgent.split(/[()]/)[1] || 'browser'
    this.cloud = await openCloudConnection({
      handle,
      code,
      label,
      onSafetyNumber: (s) => this.setSafetyNumber(s),
      onAuthed: () => this.setConnected(true),
      onAuthFailed: (err) => {
        // eslint-disable-next-line no-console
        console.warn('[cloud] auth failed:', err)
        this.setConnected(false)
        this.cloud?.close()
        this.cloud = null
        // If we were trying with a stale token, drop it and let the UI prompt for a new code.
        if (!code) clearStoredHandle()
        this.scheduleReconnect()
      },
    })
    this.cloud.onMessage((frame) => this.onMessage(frame))
  }

  async pairCloud(handle: string, code: string): Promise<void> {
    // Derive the relay-layer ticket from (handle, code) so the user only types
    // the pairing code once — no separate ticket field. Persist both before
    // opening the WS so reconnects find them.
    const { deriveTicket } = await import('@protocol/ticket')
    const ticket = await deriveTicket(handle, code)
    localStorage.setItem('codecrucible-remote-handle', handle)
    setStoredTicket(ticket)
    await this.connectCloud(code)
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    this.cloud?.close()
    this.cloud = null
    this.setSafetyNumber(null)
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return
    this.connected = v
    this.connectedListeners.forEach((cb) => cb(v))
  }

  private scheduleReconnect() {
    if (this.mode === 'lan' && !this.getToken()) return
    if (this.mode === 'cloud' && !getStoredHandle()) return
    if (this.reconnectTimer) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 2000)
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data !== 'string') return // binary reserved for future
    let frame: JsonFrame
    try {
      frame = JSON.parse(data) as JsonFrame
    } catch {
      return
    }
    if (frame.kind === 'res') {
      const pending = this.pending.get(frame.id)
      if (!pending) return
      this.pending.delete(frame.id)
      if (frame.ok) pending.resolve(frame.result)
      else pending.reject(new Error(frame.error))
      return
    }
    if (frame.kind === 'evt') {
      const set = this.listeners.get(frame.channel)
      if (set) set.forEach((cb) => cb(...frame.args))
      return
    }
  }

  async invoke(channel: IPCChannel, args: unknown[]): Promise<unknown> {
    await this.waitUntilOpen()
    const id = String(this.nextId++)
    const frame: JsonFrame = { kind: 'req', id, channel, args }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.sendFrame(JSON.stringify(frame))
    })
  }

  private sendFrame(s: string): void {
    if (this.mode === 'cloud') this.cloud?.send(s)
    else this.ws?.send(s)
  }

  private waitUntilOpen(timeoutMs = 8000): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.mode === 'lan' && !this.ws) this.connect()
    if (this.mode === 'cloud' && !this.cloud) this.connect()
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tick = () => {
        if (this.connected) return resolve()
        if (Date.now() - start > timeoutMs) return reject(new Error('Not connected'))
        setTimeout(tick, 80)
      }
      tick()
    })
  }

  on(channel: IPCChannel, cb: (...args: unknown[]) => void): () => void {
    let set = this.listeners.get(channel)
    if (!set) {
      set = new Set()
      this.listeners.set(channel, set)
    }
    set.add(cb)
    return () => set!.delete(cb)
  }
}

export const wsClient = new WsClient()

export async function pair(code: string, label: string): Promise<void> {
  const res = await fetch('/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, label }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pairing failed: ${body}`)
  }
  const { token } = (await res.json()) as { token: string }
  wsClient.setToken(token)
  wsClient.connect()
}

export async function pairCloud(handle: string, code: string): Promise<void> {
  await wsClient.pairCloud(handle, code)
}

// Tiny window.api shim: api.projects.list() -> wsClient.invoke(IPC.PROJECT_LIST, [])
export const api = {
  projects: {
    list: () => wsClient.invoke(IPC.PROJECT_LIST, []),
    update: (project: unknown) => wsClient.invoke(IPC.PROJECT_UPDATE, [project]),
  },
  sessions: {
    list: (projectId: string) => wsClient.invoke(IPC.SESSION_LIST, [projectId]),
    save: (projectId: string, sessions: unknown[]) =>
      wsClient.invoke(IPC.SESSION_SAVE, [projectId, sessions]),
  },
  notion: {
    loadConfig: (projectId: string) => wsClient.invoke(IPC.NOTION_CONFIG_LOAD, [projectId]),
    saveConfig: (projectId: string, config: unknown, opts?: unknown) =>
      wsClient.invoke(IPC.NOTION_CONFIG_SAVE, [projectId, config, opts]),
  },
  terminal: {
    listForSession: (sessionId: string) =>
      wsClient.invoke(IPC.TERMINAL_LIST_FOR_SESSION, [sessionId]),
    getBuffer: (terminalId: string) => wsClient.invoke(IPC.TERMINAL_GET_BUFFER, [terminalId]),
    spawn: (
      sessionId: string,
      cwd: string,
      mode?: string,
      claudeTheme?: string,
      claudeConfigDir?: string,
      repoPath?: string,
      resume?: boolean,
      contextId?: string,
      tabId?: string
    ) =>
      wsClient.invoke(IPC.TERMINAL_SPAWN, [
        sessionId,
        cwd,
        mode,
        claudeTheme,
        claudeConfigDir,
        repoPath,
        resume,
        contextId,
        tabId,
      ]),
    write: (terminalId: string, data: string) =>
      wsClient.invoke(IPC.TERMINAL_WRITE, [terminalId, data]),
    resize: (terminalId: string, cols: number, rows: number) =>
      wsClient.invoke(IPC.TERMINAL_RESIZE, [terminalId, cols, rows]),
    kill: (terminalId: string) => wsClient.invoke(IPC.TERMINAL_KILL, [terminalId]),
    onData: (cb: (terminalId: string, data: string) => void) =>
      wsClient.on(IPC.TERMINAL_DATA, ((tid, data) =>
        cb(tid as string, data as string)) as any),
    onExit: (cb: (terminalId: string, code: number) => void) =>
      wsClient.on(IPC.TERMINAL_EXIT, ((tid, code) =>
        cb(tid as string, code as number)) as any),
  },
  git: {
    workingFiles: (repoPath: string) =>
      wsClient.invoke(IPC.GIT_WORKING_FILES, [repoPath]),
    workingFileDiff: (repoPath: string, filePath: string) =>
      wsClient.invoke(IPC.GIT_WORKING_FILE_DIFF, [repoPath, filePath]),
  },
}

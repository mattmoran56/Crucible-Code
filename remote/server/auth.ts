import { randomBytes } from 'node:crypto'
import Store from 'electron-store'

export interface PairedDevice {
  token: string
  label: string
  createdAt: number
}

const store = new Store<{ devices: PairedDevice[] }>({
  name: 'remote-devices',
  defaults: { devices: [] },
})

export function issueToken(label: string): string {
  const token = randomBytes(32).toString('hex')
  const devices = store.get('devices', [])
  devices.push({ token, label, createdAt: Date.now() })
  store.set('devices', devices)
  return token
}

export function verifyToken(token: string | null | undefined): boolean {
  if (!token) return false
  return store.get('devices', []).some((d) => d.token === token)
}

export function listDevices(): PairedDevice[] {
  return store.get('devices', []).map((d) => ({ ...d, token: d.token.slice(0, 8) + '…' }))
}

export function revokeDevice(tokenPrefix: string): void {
  const devices = store.get('devices', []).filter(
    (d) => !d.token.startsWith(tokenPrefix.replace(/…$/, ''))
  )
  store.set('devices', devices)
}

export function revokeAll(): void {
  store.set('devices', [])
}

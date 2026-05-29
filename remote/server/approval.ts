import Store from 'electron-store'
import { currentPairingCode } from './pairing'

// Approval gate: when `requireApproval` is on, the desktop user must click
// Approve in the popover before a pairing attempt is allowed to mint a token.
// When off, awaitApproval resolves true immediately (existing behaviour).

const settingsStore = new Store<{ requireApproval: boolean }>({
  name: 'remote-approval',
  defaults: { requireApproval: false },
})

export function isRequireApproval(): boolean {
  return settingsStore.get('requireApproval', false)
}

export function setRequireApproval(v: boolean): void {
  settingsStore.set('requireApproval', v)
}

const APPROVAL_TIMEOUT_MS = 60_000

export interface PendingPairing {
  id: string
  label: string
  mode: 'lan' | 'cloud'
  code: string | null
  createdAt: number
}

interface PendingEntry extends PendingPairing {
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingEntry>()
let onChange: (() => void) | null = null

export function setApprovalChangeListener(cb: () => void): void {
  onChange = cb
}

export function listPendingPairings(): PendingPairing[] {
  return Array.from(pending.values()).map(({ id, label, mode, code, createdAt }) => ({
    id,
    label,
    mode,
    code,
    createdAt,
  }))
}

function genId(): string {
  return `pair_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function awaitApproval(label: string, mode: 'lan' | 'cloud'): Promise<boolean> {
  if (!isRequireApproval()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const id = genId()
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        onChange?.()
        resolve(false)
      }
    }, APPROVAL_TIMEOUT_MS)
    pending.set(id, {
      id,
      label,
      mode,
      code: currentPairingCode(),
      createdAt: Date.now(),
      resolve,
      timer,
    })
    onChange?.()
  })
}

function settle(id: string, approved: boolean): boolean {
  const entry = pending.get(id)
  if (!entry) return false
  clearTimeout(entry.timer)
  pending.delete(id)
  entry.resolve(approved)
  onChange?.()
  return true
}

export function approvePairing(id: string): boolean {
  return settle(id, true)
}

export function denyPairing(id: string): boolean {
  return settle(id, false)
}

export function rejectAllPending(): void {
  for (const id of Array.from(pending.keys())) settle(id, false)
}

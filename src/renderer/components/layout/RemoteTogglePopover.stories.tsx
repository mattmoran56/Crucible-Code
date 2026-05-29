import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { RemoteTogglePopover } from './RemoteTogglePopover'

interface PendingPairing {
  id: string
  label: string
  mode: 'lan' | 'cloud'
  code: string | null
  createdAt: number
}

interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
  pairingCode: string | null
  devices: { token: string; label: string; createdAt: number }[]
  cloud: {
    enabled: boolean
    handle: string | null
    ticket: string | null
    connected: boolean
    safetyNumber: string | null
  }
  requireApproval: boolean
  pendingPairings: PendingPairing[]
}

function baseStatus(): RemoteStatus {
  return {
    enabled: false,
    running: false,
    port: 9876,
    urls: [],
    pairingCode: null,
    devices: [],
    cloud: {
      enabled: false,
      handle: null,
      ticket: null,
      connected: false,
      safetyNumber: null,
    },
    requireApproval: false,
    pendingPairings: [],
  }
}

// The popover reads `window.api.remote`. Storybook's global preview mock
// (mock/mockApi.ts) doesn't include a remote namespace, so each story injects
// its own scenario via this decorator and clears it on unmount.
function withRemoteApi(status: RemoteStatus, opts: { autoOpen?: boolean } = {}) {
  return (Story: React.ComponentType) => {
    const api = window.api as Record<string, unknown>
    const prev = api.remote
    let current = status
    const listeners = new Set<(s: RemoteStatus) => void>()
    api.remote = {
      getStatus: async () => current,
      setEnabled: async (enabled: boolean) => {
        current = { ...current, enabled, running: enabled }
        listeners.forEach((cb) => cb(current))
        return current
      },
      regenerateCode: async () => current,
      revokeAll: async () => {
        current = { ...current, devices: [] }
        return current
      },
      onStatusChanged: (cb: (s: RemoteStatus) => void) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      setCloudEnabled: async (enabled: boolean) => {
        current = { ...current, cloud: { ...current.cloud, enabled } }
        return current
      },
      regenerateHandle: async () => current,
      setRequireApproval: async (enabled: boolean) => {
        current = { ...current, requireApproval: enabled }
        return current
      },
      approvePairing: async (id: string) => {
        current = {
          ...current,
          pendingPairings: current.pendingPairings.filter((p) => p.id !== id),
        }
        return current
      },
      denyPairing: async (id: string) => {
        current = {
          ...current,
          pendingPairings: current.pendingPairings.filter((p) => p.id !== id),
        }
        return current
      },
      onPairingRequested: (cb: (pending: PendingPairing[]) => void) => {
        // Fire once on mount if we want to auto-open the popover.
        if (opts.autoOpen && current.pendingPairings.length > 0) {
          queueMicrotask(() => cb(current.pendingPairings))
        }
        return () => {}
      },
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      return () => {
        api.remote = prev
      }
    }, [])
    return (
      <div style={{ padding: 80, minHeight: 480, background: '#f5f5f5' }}>
        <Story />
      </div>
    )
  }
}

const meta: Meta<typeof RemoteTogglePopover> = {
  title: 'Layout/RemoteTogglePopover',
  component: RemoteTogglePopover,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof RemoteTogglePopover>

export const Closed: Story = {
  decorators: [withRemoteApi(baseStatus())],
}

export const Open_LanOnly: Story = {
  decorators: [
    withRemoteApi({
      ...baseStatus(),
      enabled: true,
      running: true,
      urls: ['http://192.168.1.42:9876'],
      pairingCode: 'KX7QM2',
    }),
  ],
  // Click the toggle so the popover renders. Story renders the closed button;
  // a manual click in the Storybook UI opens it. To make a static screenshot,
  // we expose a play function via beforeEach if needed.
}

export const Open_CloudConnected: Story = {
  decorators: [
    withRemoteApi({
      ...baseStatus(),
      enabled: true,
      running: true,
      urls: ['http://192.168.1.42:9876'],
      pairingCode: 'KX7QM2',
      cloud: {
        enabled: true,
        handle: 'lively-ember-falcon',
        ticket: 'ticket-stub',
        connected: true,
        safetyNumber: '83 421  19 902  44 117  60 588',
      },
    }),
  ],
}

export const Open_PendingPairing: Story = {
  decorators: [
    withRemoteApi(
      {
        ...baseStatus(),
        enabled: true,
        running: true,
        urls: ['http://192.168.1.42:9876'],
        pairingCode: 'KX7QM2',
        requireApproval: true,
        cloud: {
          enabled: true,
          handle: 'lively-ember-falcon',
          ticket: 'ticket-stub',
          connected: true,
          safetyNumber: '83 421  19 902  44 117  60 588',
        },
        pendingPairings: [
          {
            id: 'pair_demo_1',
            label: "Matt's iPhone",
            mode: 'cloud',
            code: 'KX7QM2',
            createdAt: Date.now(),
          },
        ],
      },
      { autoOpen: true },
    ),
  ],
}

export const Open_RequireApprovalOn: Story = {
  decorators: [
    withRemoteApi({
      ...baseStatus(),
      enabled: true,
      running: true,
      urls: ['http://192.168.1.42:9876'],
      pairingCode: 'KX7QM2',
      requireApproval: true,
    }),
  ],
}

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { IPC, REMOTE_DEFAULT_PORT } from '../../../remote/protocol/channels'
import { IPC as SHARED_IPC } from '../../../src/shared/constants'
// The vitest alias @protocol -> remote/protocol must resolve to the same module.
import { IPC as ALIASED_IPC, REMOTE_DEFAULT_PORT as ALIASED_PORT } from '@protocol/channels'

describe('remote/protocol/channels', () => {
  it('exposes REMOTE_DEFAULT_PORT 7878', () => {
    expect(REMOTE_DEFAULT_PORT).toBe(7878)
  })

  it('default port is an unprivileged integer port', () => {
    expect(Number.isInteger(REMOTE_DEFAULT_PORT)).toBe(true)
    expect(REMOTE_DEFAULT_PORT).toBeGreaterThan(1024)
    expect(REMOTE_DEFAULT_PORT).toBeLessThan(65536)
  })

  it('re-exports the exact IPC object from src/shared/constants', () => {
    // Identity, not a copy — both sides of the bridge must agree on channel names.
    expect(IPC).toBe(SHARED_IPC)
  })

  it('@protocol alias resolves to the same channels module', () => {
    expect(ALIASED_IPC).toBe(IPC)
    expect(ALIASED_PORT).toBe(REMOTE_DEFAULT_PORT)
  })

  it('every IPC channel value is a non-empty string', () => {
    const values = Object.values(IPC)
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) {
      expect(typeof v).toBe('string')
      expect((v as string).length).toBeGreaterThan(0)
    }
  })

  it('IPC channel values are globally unique', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('IPC channel values follow the namespace:action convention', () => {
    for (const v of Object.values(IPC)) {
      // At least one colon separating alphanumeric/hyphen segments
      // (e.g. 'git:status', 'session:context:save', 'update:builtCommit').
      expect(v).toMatch(/^[a-zA-Z0-9-]+(:[a-zA-Z0-9-]+)+$/)
    }
  })

  it('IPC keys are SCREAMING_SNAKE_CASE', () => {
    for (const k of Object.keys(IPC)) {
      expect(k).toMatch(/^[A-Z0-9]+(_[A-Z0-9]+)*$/)
    }
  })

  it('includes the remote-control channels used by the relay UI', () => {
    expect(IPC.REMOTE_GET_STATUS).toBe('remote:get-status')
    expect(IPC.REMOTE_SET_ENABLED).toBe('remote:set-enabled')
    expect(IPC.REMOTE_REGENERATE_CODE).toBe('remote:regenerate-code')
    expect(IPC.REMOTE_REVOKE_ALL).toBe('remote:revoke-all')
    expect(IPC.REMOTE_STATUS_CHANGED).toBe('remote:status-changed')
    expect(IPC.REMOTE_SET_CLOUD_ENABLED).toBe('remote:set-cloud-enabled')
    expect(IPC.REMOTE_REGENERATE_HANDLE).toBe('remote:regenerate-handle')
  })

  it('includes the pairing approval channels', () => {
    expect(IPC.REMOTE_SET_REQUIRE_APPROVAL).toBe('remote:set-require-approval')
    expect(IPC.REMOTE_APPROVE_PAIRING).toBe('remote:approve-pairing')
    expect(IPC.REMOTE_DENY_PAIRING).toBe('remote:deny-pairing')
    expect(IPC.REMOTE_PAIRING_REQUESTED).toBe('remote:pairing-requested')
    expect(IPC.REMOTE_SET_PAIRING_MODE).toBe('remote:set-pairing-mode')
  })

  it('includes the terminal channels mirrored by the binary frame opcodes', () => {
    expect(IPC.TERMINAL_DATA).toBe('terminal:data')
    expect(IPC.TERMINAL_RESIZE).toBe('terminal:resize')
    expect(IPC.TERMINAL_WRITE).toBe('terminal:write')
  })
})

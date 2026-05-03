import { beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { useButtonShortcuts } from '../../../src/renderer/hooks/useButtonShortcuts'
import { useButtonStore } from '../../../src/renderer/stores/buttonStore'

function Harness() {
  useButtonShortcuts()
  return <div />
}

beforeEach(() => {
  useButtonStore.setState({ buttons: [], groups: [], runningButtons: {} } as any)
})

const B = (overrides: Partial<{ id: string; shortcut: string }> = {}) =>
  ({
    id: 'b1',
    label: 'Run tests',
    command: 'echo',
    placement: 'session-toolbar',
    scope: { type: 'global' },
    actionType: 'shell',
    executionMode: 'background',
    order: 0,
    shortcut: 'Cmd+Shift+T',
    ...overrides,
  }) as any

describe('useButtonShortcuts', () => {
  it('triggers executeButton on a matching keydown', () => {
    const exec = vi.spyOn(useButtonStore.getState(), 'executeButton').mockResolvedValue(undefined as any)
    useButtonStore.setState({ buttons: [B()] } as any)
    render(<Harness />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }))
    expect(exec).toHaveBeenCalledWith('b1')
    exec.mockRestore()
  })

  it('does not fire when modifiers do not match', () => {
    const exec = vi.spyOn(useButtonStore.getState(), 'executeButton').mockResolvedValue(undefined as any)
    useButtonStore.setState({ buttons: [B({ shortcut: 'Ctrl+Shift+T' })] } as any)
    render(<Harness />)
    // Press only Cmd+Shift+T (no Ctrl) — should not match
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }))
    expect(exec).not.toHaveBeenCalled()
    exec.mockRestore()
  })

  it('handles a plain function key shortcut', () => {
    const exec = vi.spyOn(useButtonStore.getState(), 'executeButton').mockResolvedValue(undefined as any)
    useButtonStore.setState({ buttons: [B({ id: 'fn', shortcut: 'F5' })] } as any)
    render(<Harness />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }))
    expect(exec).toHaveBeenCalledWith('fn')
    exec.mockRestore()
  })

  it('does nothing when there are no buttons with shortcuts', () => {
    const exec = vi.spyOn(useButtonStore.getState(), 'executeButton').mockResolvedValue(undefined as any)
    render(<Harness />)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }))
    expect(exec).not.toHaveBeenCalled()
    exec.mockRestore()
  })
})

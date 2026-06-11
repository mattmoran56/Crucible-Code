import { beforeEach, describe, expect, it } from 'vitest'
import React from 'react'
import { render } from '@testing-library/react'
import { useSettingsShortcut } from '../../../src/renderer/hooks/useSettingsShortcut'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

function Harness() {
  useSettingsShortcut()
  return <div />
}

beforeEach(() => {
  useSettingsStore.setState({ isOpen: false })
})

function fire(init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { cancelable: true, ...init })
  window.dispatchEvent(e)
  return e
}

describe('useSettingsShortcut', () => {
  it('opens settings on Cmd+,', () => {
    render(<Harness />)
    const e = fire({ key: ',', metaKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(true)
    expect(e.defaultPrevented).toBe(true)
  })

  it('opens settings on Ctrl+,', () => {
    render(<Harness />)
    fire({ key: ',', ctrlKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(true)
  })

  it('closes settings when already open (toggle)', () => {
    useSettingsStore.setState({ isOpen: true })
    render(<Harness />)
    fire({ key: ',', metaKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(false)
  })

  it('ignores plain "," without a modifier', () => {
    render(<Harness />)
    const e = fire({ key: ',' })
    expect(useSettingsStore.getState().isOpen).toBe(false)
    expect(e.defaultPrevented).toBe(false)
  })

  it('ignores Cmd+Shift+, and Cmd+Alt+,', () => {
    render(<Harness />)
    fire({ key: ',', metaKey: true, shiftKey: true })
    fire({ key: ',', metaKey: true, altKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(false)
  })

  it('ignores other keys with Cmd held', () => {
    render(<Harness />)
    fire({ key: '.', metaKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(false)
  })

  it('removes its listener on unmount', () => {
    const { unmount } = render(<Harness />)
    unmount()
    fire({ key: ',', metaKey: true })
    expect(useSettingsStore.getState().isOpen).toBe(false)
  })
})

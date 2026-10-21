import React, { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { composerKeyAction, typedKey } from '../../../../src/renderer/components/visual-agent/composerKeys'
import { BUILTIN_COMMANDS, commandQuery, intentOf, matchCommands } from '../../../../src/renderer/components/visual-agent/commands'
import { Composer, type ComposerProps } from '../../../../src/renderer/components/visual-agent/Composer'

describe('composerKeyAction', () => {
  const idle = { running: false }
  const busy = { running: true }
  it('Enter sends, Shift/Alt+Enter is a newline', () => {
    expect(composerKeyAction({ key: 'Enter' }, idle)).toBe('send')
    expect(composerKeyAction({ key: 'Enter', shiftKey: true }, idle)).toBeNull()
    expect(composerKeyAction({ key: 'Enter', altKey: true }, idle)).toBeNull()
  })
  it('Cmd/Ctrl+Enter asks aside', () => {
    expect(composerKeyAction({ key: 'Enter', metaKey: true }, idle)).toBe('fork')
    expect(composerKeyAction({ key: 'Enter', ctrlKey: true }, idle)).toBe('fork')
  })
  it('is inert during IME composition', () => {
    expect(composerKeyAction({ key: 'Enter', isComposing: true }, idle)).toBeNull()
    expect(composerKeyAction({ key: 'Enter', keyCode: 229 }, idle)).toBeNull()
  })
  it('Esc interrupts only while running', () => {
    expect(composerKeyAction({ key: 'Escape' }, busy)).toBe('interrupt')
    expect(composerKeyAction({ key: 'Escape' }, idle)).toBeNull()
  })
  it('typedKey routes printable keys without modifiers', () => {
    expect(typedKey({ key: 'a' })).toBe('a')
    expect(typedKey({ key: 'a', metaKey: true })).toBeNull()
    expect(typedKey({ key: 'Enter' })).toBeNull()
  })
})

describe('commands', () => {
  it('opens the menu only for a bare /word', () => {
    expect(commandQuery('/co')).toBe('/co')
    expect(commandQuery('/btw hi')).toBeNull()
    expect(commandQuery('hi')).toBeNull()
  })
  it('ranks exact, then prefix, then subsequence', () => {
    expect(matchCommands(BUILTIN_COMMANDS, '/c').map((c) => c.name).slice(0, 3)).toEqual(['/compact', '/clear', '/cost'])
    expect(matchCommands(BUILTIN_COMMANDS, '/btw')[0].name).toBe('/btw')
  })
  it('reads intent from a draft', () => {
    expect(intentOf('/btw why?')).toEqual({ kind: 'fork', question: 'why?' })
    expect(intentOf('/btw').kind).toBe('invalid')
    expect(intentOf('/clear')).toEqual({ kind: 'clear' })
    expect(intentOf('/compact keep tests')).toEqual({ kind: 'send', text: '/compact keep tests' })
    expect(intentOf('   ').kind).toBe('empty')
  })
})

function Harness(props: Partial<ComposerProps> & { initial?: string }) {
  const [draft, setDraft] = useState(props.initial ?? '')
  return (
    <Composer
      draft={draft}
      onDraft={setDraft}
      running={false}
      model="claude-opus-5-5"
      onModel={vi.fn()}
      onSend={vi.fn()}
      onFork={vi.fn()}
      onInterrupt={vi.fn()}
      onClear={vi.fn()}
      {...props}
    />
  )
}

describe('<Composer>', () => {
  it('sends on Enter and clears the draft', () => {
    const onSend = vi.fn()
    render(<Harness initial="hello" onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(box.value).toBe('')
  })

  it('does not send on Shift+Enter or mid-composition', () => {
    const onSend = vi.fn()
    render(<Harness initial="hello" onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude')
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('routes /btw and Cmd+Enter to a fork', () => {
    const onFork = vi.fn()
    const { unmount } = render(<Harness initial="/btw is it safe?" onFork={onFork} />)
    fireEvent.keyDown(screen.getByLabelText('Message Claude'), { key: 'Enter' })
    expect(onFork).toHaveBeenCalledWith('is it safe?')
    unmount()
    render(<Harness initial="side thought" onFork={onFork} />)
    fireEvent.keyDown(screen.getByLabelText('Message Claude'), { key: 'Enter', metaKey: true })
    expect(onFork).toHaveBeenLastCalledWith('side thought')
  })

  it('Esc interrupts while running', () => {
    const onInterrupt = vi.fn()
    render(<Harness running onInterrupt={onInterrupt} />)
    fireEvent.keyDown(screen.getByLabelText('Message Claude'), { key: 'Escape' })
    expect(onInterrupt).toHaveBeenCalled()
  })

  it('opens the slash menu, moves with arrows and accepts with Enter', () => {
    const onSend = vi.fn()
    render(<Harness initial="/" onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    expect(box).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(box.value).toBe('/compact ')
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc closes the slash menu without interrupting', () => {
    const onInterrupt = vi.fn()
    render(<Harness initial="/" running onInterrupt={onInterrupt} />)
    const box = screen.getByLabelText('Message Claude')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(onInterrupt).not.toHaveBeenCalled()
  })

  it('locks the model picker while a turn runs', () => {
    render(<Harness running />)
    expect(screen.getByRole('button', { name: /Opus 5.5/ })).toHaveAttribute('aria-disabled', 'true')
  })
})

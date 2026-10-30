import React, { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { composerKeyAction, typedKey } from '../../../../src/renderer/components/visual-agent/composerKeys'
import { BUILTIN_COMMANDS, commandQuery, intentOf, matchCommands, sessionCommands } from '../../../../src/renderer/components/visual-agent/commands'
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
  it('builds the menu from what the session reports: panel commands, then the repo\'s, then built-ins', () => {
    expect(sessionCommands(undefined)).toBe(BUILTIN_COMMANDS)
    expect(sessionCommands([])).toBe(BUILTIN_COMMANDS)
    const menu = sessionCommands([
      { name: 'compact', description: 'Compact', argumentHint: '[instructions]', builtin: true },
      { name: 'deploy', description: 'Deploy (project)', argumentHint: '<env>', builtin: false },
      { name: 'clear', description: 'Clear', argumentHint: '', builtin: true },
      { name: 'my-skill', description: 'A skill (project)', argumentHint: '', builtin: false },
    ])
    expect(menu.map((c) => c.name)).toEqual(['/btw', '/clear', '/model', '/deploy', '/my-skill', '/compact'])
    expect(menu[3]).toEqual({ name: '/deploy', description: 'Deploy (project)', args: '<env>', handledBy: 'session' })
    expect(menu[1].handledBy).toBe('panel')
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
    expect(onSend).toHaveBeenCalledWith('hello', [])
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

  it('opens the slash menu, moves with arrows and inserts with Tab', () => {
    const onSend = vi.fn()
    render(<Harness initial="/" onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    expect(box).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Tab' })
    expect(onSend).not.toHaveBeenCalled()
    expect(box.value).toBe('/compact ')
    expect(box).toHaveAttribute('aria-expanded', 'false')
  })

  it('inserts and sends the chosen slash command on Enter', () => {
    const onSend = vi.fn()
    render(<Harness initial="/rev" onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('/review', [])
    expect(box.value).toBe('')
  })

  it('runs panel commands on Enter', () => {
    const onClear = vi.fn()
    render(<Harness initial="/cle" onClear={onClear} />)
    fireEvent.keyDown(screen.getByLabelText('Message Claude'), { key: 'Enter' })
    expect(onClear).toHaveBeenCalled()
  })

  it('only inserts a command that needs an argument on Enter', () => {
    const onSend = vi.fn()
    const onFork = vi.fn()
    render(<Harness initial="/bt" onSend={onSend} onFork={onFork} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
    expect(onFork).not.toHaveBeenCalled()
    expect(box.value).toBe('/btw ')
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

  it('sends attachments with the text, or on their own', () => {
    const onSend = vi.fn()
    const shot = { name: 'shot.png', type: 'image/png', size: 3, data: 'cG5n' }
    const { unmount } = render(<Harness initial="see this" onSend={onSend} attachments={[shot]} onAddFiles={vi.fn()} />)
    expect(screen.getByRole('list', { name: 'Attachments' })).toHaveTextContent('shot.png')
    fireEvent.keyDown(screen.getByLabelText('Message Claude'), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('see this', [shot])
    unmount()
    onSend.mockClear()
    render(<Harness onSend={onSend} attachments={[shot]} onAddFiles={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('', [shot])
  })

  it('the + button picks files, and a chip can be removed', () => {
    const onAddFiles = vi.fn()
    const onRemoveAttachment = vi.fn()
    render(
      <Harness
        attachments={[{ name: 'notes.md', type: 'text/markdown', size: 2, data: 'aGk=' }]}
        onAddFiles={onAddFiles}
        onRemoveAttachment={onRemoveAttachment}
      />,
    )
    const input = screen.getByTestId('composer-file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    expect(click).toHaveBeenCalled()
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onAddFiles).toHaveBeenCalledWith([file])
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.md' }))
    expect(onRemoveAttachment).toHaveBeenCalledWith(0)
  })

  it('pasting an image adds it as an attachment', () => {
    const onAddFiles = vi.fn()
    render(<Harness onAddFiles={onAddFiles} />)
    const file = new File(['png'], 'image.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Message Claude'), { clipboardData: { files: [file] } })
    expect(onAddFiles).toHaveBeenCalledWith([file])
  })

  it('has no + button when the owner takes no files', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull()
  })
})

describe('<Composer> dictation mode', () => {
  const pasteText = (box: HTMLElement, text: string, value: string): void => {
    fireEvent.paste(box, { clipboardData: { files: [], getData: () => text } })
    fireEvent.change(box, { target: { value } })
  }

  it('sends pasted text straight away when on', () => {
    const onSend = vi.fn()
    render(<Harness dictation onDictation={vi.fn()} onSend={onSend} onAddFiles={vi.fn()} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    pasteText(box, 'fix the build', 'fix the build')
    expect(onSend).toHaveBeenCalledWith('fix the build', [])
    expect(box.value).toBe('')
  })

  it('sends the whole draft, including what was typed before the paste', () => {
    const onSend = vi.fn()
    render(<Harness initial="please " dictation onSend={onSend} />)
    pasteText(screen.getByLabelText('Message Claude'), 'run the tests', 'please run the tests')
    expect(onSend).toHaveBeenCalledWith('please run the tests', [])
  })

  it('leaves pasted text in the box when off', () => {
    const onSend = vi.fn()
    render(<Harness dictation={false} onDictation={vi.fn()} onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    pasteText(box, 'fix the build', 'fix the build')
    expect(onSend).not.toHaveBeenCalled()
    expect(box.value).toBe('fix the build')
  })

  it('only sends for a paste: typing still waits for Enter', () => {
    const onSend = vi.fn()
    render(<Harness dictation onSend={onSend} />)
    const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'h' } })
    expect(onSend).not.toHaveBeenCalled()
    expect(box.value).toBe('h')
  })

  it('a pasted image is still just attached', () => {
    const onSend = vi.fn()
    const onAddFiles = vi.fn()
    render(<Harness dictation onSend={onSend} onAddFiles={onAddFiles} />)
    const file = new File(['png'], 'image.png', { type: 'image/png' })
    fireEvent.paste(screen.getByLabelText('Message Claude'), { clipboardData: { files: [file], getData: () => '' } })
    expect(onAddFiles).toHaveBeenCalledWith([file])
    expect(onSend).not.toHaveBeenCalled()
  })

  it('the toggle shows its state and flips it', () => {
    const onDictation = vi.fn()
    const { rerender } = render(<Harness dictation onDictation={onDictation} />)
    const toggle = screen.getByRole('switch', { name: 'Dictation mode' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(onDictation).toHaveBeenCalledWith(false)
    rerender(<Harness dictation={false} onDictation={onDictation} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Dictation mode' }))
    expect(onDictation).toHaveBeenLastCalledWith(true)
  })

  describe('smart', () => {
    it('sends a paste the clipboard shows a dictation app made', async () => {
      const onSend = vi.fn()
      const isDictatedPaste = vi.fn().mockResolvedValue(true)
      render(<Harness initial="please " dictation smartDictation isDictatedPaste={isDictatedPaste} onSend={onSend} />)
      const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
      pasteText(box, 'fix the build', 'please fix the build')
      await waitFor(() => expect(onSend).toHaveBeenCalledWith('please fix the build', []))
      expect(isDictatedPaste).toHaveBeenCalledTimes(1)
      expect(box.value).toBe('')
    })

    it('leaves a paste of your own in the box', async () => {
      const onSend = vi.fn()
      const isDictatedPaste = vi.fn().mockResolvedValue(false)
      render(<Harness dictation smartDictation isDictatedPaste={isDictatedPaste} onSend={onSend} />)
      const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
      pasteText(box, 'some copied text', 'some copied text')
      await waitFor(() => expect(isDictatedPaste).toHaveBeenCalled())
      await Promise.resolve()
      expect(onSend).not.toHaveBeenCalled()
      expect(box.value).toBe('some copied text')
    })

    it('keeps the paste when the clipboard cannot be asked', async () => {
      const onSend = vi.fn()
      const isDictatedPaste = vi.fn().mockRejectedValue(new Error('no ipc'))
      render(<Harness dictation smartDictation isDictatedPaste={isDictatedPaste} onSend={onSend} />)
      const box = screen.getByLabelText('Message Claude') as HTMLTextAreaElement
      pasteText(box, 'dictated', 'dictated')
      await waitFor(() => expect(isDictatedPaste).toHaveBeenCalled())
      expect(onSend).not.toHaveBeenCalled()
      expect(box.value).toBe('dictated')
    })

    it('does not ask when dictation mode is off', () => {
      const isDictatedPaste = vi.fn().mockResolvedValue(true)
      render(<Harness dictation={false} smartDictation isDictatedPaste={isDictatedPaste} />)
      pasteText(screen.getByLabelText('Message Claude'), 'text', 'text')
      expect(isDictatedPaste).not.toHaveBeenCalled()
    })
  })

  it('has no toggle when the owner does not offer one', () => {
    render(<Harness />)
    expect(screen.queryByRole('switch', { name: 'Dictation mode' })).toBeNull()
  })
})

// The composer: an autogrowing textarea with the slash menu sliding up above
// it, the model pill and hints below it, and the panel's only filled button.
// Files ride along as chips above the textarea: picked with the + button,
// pasted, or dropped anywhere on the panel.

import React, { forwardRef, useLayoutEffect, useRef, useState } from 'react'
import { isInlineImage, type VisualAgentAttachment, type VisualAgentModel } from '../../../shared/visual-agent'
import { cn } from '../../lib/cn'
import { BUILTIN_COMMANDS, intentOf, type SlashCommand } from './commands'
import { CommandMenu, useCommandMenu } from './CommandMenu'
import { composerKeyAction } from './composerKeys'
import { Close, FileIcon, Plus, SendArrow, StopSquare } from './icons'
import { ModelPicker, type ModelPickerHandle } from './ModelPicker'

const MAX_HEIGHT = 220

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? '⌘' : 'Ctrl+'

export interface ComposerProps {
  draft: string
  onDraft: (draft: string) => void
  /** A turn is in flight (Esc interrupts; model is locked). */
  running: boolean
  /** The session can't take input at all (starting, ended). */
  disabled?: boolean
  placeholder?: string
  model: string
  models?: readonly VisualAgentModel[]
  onModel: (model: string) => void
  onSend: (text: string, attachments: VisualAgentAttachment[]) => void
  onFork: (question: string) => void
  onInterrupt: () => void
  onClear: () => void
  commands?: readonly SlashCommand[]
  /** Files waiting to go with the next message. */
  attachments?: readonly VisualAgentAttachment[]
  /** Files picked or pasted: the owner reads them and adds them to `attachments`. */
  onAddFiles?: (files: File[]) => void
  onRemoveAttachment?: (index: number) => void
  /** A notice from outside (a dropped file turned away); the composer's own wins. */
  notice?: string | null
}

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(function Composer(
  {
    draft,
    onDraft,
    running,
    disabled = false,
    placeholder,
    model,
    models,
    onModel,
    onSend,
    onFork,
    onInterrupt,
    onClear,
    commands = BUILTIN_COMMANDS,
    attachments = NO_ATTACHMENTS,
    onAddFiles,
    onRemoveAttachment,
    notice: outsideNotice = null,
  },
  ref,
) {
  const box = useRef<HTMLTextAreaElement | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const picker = useRef<ModelPickerHandle>(null)
  const [ownNotice, setNotice] = useState<string | null>(null)
  const notice = ownNotice ?? outsideNotice
  const attaching = attachments.length > 0

  const setRefs = (element: HTMLTextAreaElement | null): void => {
    box.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [draft])

  const menu = useCommandMenu({
    commands,
    draft,
    onAccept: (command, how) => {
      box.current?.focus()
      // A command with a required `<arg>` can't run bare, so Enter only inserts it.
      if (how === 'send' && !command.args?.startsWith('<')) {
        submit(command.name)
        return
      }
      onDraft(`${command.name} `)
    },
  })

  function submit(text: string = draft): void {
    const intent = intentOf(text)
    setNotice(null)
    switch (intent.kind) {
      case 'empty':
        if (attaching) onSend('', [...attachments])
        else return
        break
      case 'invalid':
        setNotice(intent.message)
        return
      case 'fork':
        onFork(intent.question)
        break
      case 'clear':
        onClear()
        break
      case 'model':
        picker.current?.open()
        break
      case 'send':
        onSend(intent.text, [...attachments])
        break
    }
    onDraft('')
  }

  const askAside = (): void => {
    const intent = intentOf(draft)
    const question = intent.kind === 'fork' ? intent.question : draft.trim()
    if (!question) {
      setNotice('Type a question to ask aside')
      return
    }
    setNotice(null)
    onFork(question)
    onDraft('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (menu.onKeyDown(event)) return
    const action = composerKeyAction(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      },
      { running },
    )
    if (!action) return
    event.preventDefault()
    if (action === 'send') submit()
    else if (action === 'fork') askAside()
    else if (action === 'interrupt') onInterrupt()
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!onAddFiles) return
    const files = Array.from(event.clipboardData?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    onAddFiles(files)
  }

  const canSend = !disabled && (draft.trim() !== '' || attaching)

  return (
    <div className="shrink-0 px-3! pb-2.5! pt-2!">
      <div className="relative">
        <CommandMenu menu={menu} />
        <div
          className={cn(
            'flex items-end gap-2 rounded-xl border bg-bg-secondary px-3! py-2! transition-colors',
            'focus-within:border-accent/70',
            disabled ? 'border-border opacity-70' : 'border-border',
            attaching && 'flex-wrap',
          )}
        >
          {attaching ? (
            <ul aria-label="Attachments" className="flex w-full flex-wrap gap-1.5 pb-1!">
              {attachments.map((attachment, i) => (
                <AttachmentChip
                  key={`${i}-${attachment.name}`}
                  attachment={attachment}
                  onRemove={onRemoveAttachment ? () => onRemoveAttachment(i) : undefined}
                />
              ))}
            </ul>
          ) : null}
          {onAddFiles ? (
            <>
              <button
                type="button"
                onClick={() => filePicker.current?.click()}
                disabled={disabled}
                aria-label="Attach files"
                title="Attach images or files (or drop them here)"
                className="mb-[1px]! grid size-7 shrink-0 place-items-center rounded-lg border border-border text-text-muted transition-colors hover:border-accent/60 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
              >
                <Plus size={13} />
              </button>
              <input
                ref={filePicker}
                type="file"
                multiple
                hidden
                data-testid="composer-file-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  e.target.value = ''
                  if (files.length > 0) onAddFiles(files)
                }}
              />
            </>
          ) : null}
          <textarea
            ref={setRefs}
            rows={1}
            value={draft}
            disabled={disabled}
            onChange={(e) => {
              setNotice(null)
              onDraft(e.target.value)
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={placeholder ?? (running ? 'Queue a follow-up…' : 'Message Claude — / for commands')}
            aria-label="Message Claude"
            {...menu.field}
            className="max-h-[220px] min-h-[22px] flex-1 resize-none bg-transparent py-[2px]! text-[13px] leading-[1.5] text-text outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={askAside}
            disabled={disabled || !draft.trim()}
            title={`Ask aside in a fork (${MOD}Enter)`}
            className="mb-[1px]! shrink-0 rounded-md border border-border px-2! py-1! text-[11px] text-text-muted transition-colors hover:border-accent/60 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
          >
            ✦ Ask aside
          </button>
          <button
            type="button"
            onClick={() => submit()}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-40 disabled:hover:bg-accent"
          >
            <SendArrow size={13} />
          </button>
        </div>
      </div>
      <div className="mt-1.5! flex min-h-[20px] items-center gap-2 text-[10.5px] text-text-muted">
        <ModelPicker
          ref={picker}
          model={model}
          models={models}
          onChange={onModel}
          disabled={running || disabled}
          disabledReason={running ? 'The model can be changed between turns' : 'Session is not running'}
        />
        {notice ? (
          <span role="status" className="text-warning">
            {notice}
          </span>
        ) : running ? (
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border px-1! font-sans">Esc</kbd> to interrupt
            <button
              type="button"
              onClick={onInterrupt}
              className="ml-1! inline-flex items-center gap-1 rounded px-1! hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <StopSquare size={9} /> Stop
            </button>
          </span>
        ) : (
          <span className="truncate">
            Enter to send · Shift+Enter for a new line · {MOD}Enter to ask aside · / for commands
          </span>
        )}
      </div>
    </div>
  )
})

const NO_ATTACHMENTS: readonly VisualAgentAttachment[] = []

/** One waiting file: a thumbnail for an image, an icon and name for anything else. */
function AttachmentChip({ attachment, onRemove }: { attachment: VisualAgentAttachment; onRemove?: () => void }) {
  const image = isInlineImage(attachment)
  return (
    <li className="flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-bg py-1! pl-1! pr-1.5! text-[11.5px] text-text">
      {image ? (
        <img
          src={`data:${attachment.type};base64,${attachment.data}`}
          alt=""
          className="size-7 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded bg-bg-secondary text-text-muted">
          <FileIcon size={13} />
        </span>
      )}
      <span className="min-w-0 truncate" title={attachment.name}>
        {attachment.name}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${attachment.name}`}
          className="grid size-4 shrink-0 place-items-center rounded text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Close size={9} />
        </button>
      ) : null}
    </li>
  )
}

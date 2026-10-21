// The slash-command menu: slides up above the composer while the draft is a
// bare `/word`, and is driven from the textarea's keydown (↑/↓/Enter/Tab/Esc)
// as an ARIA combobox so focus never leaves the composer.

import React, { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { cn } from '../../lib/cn'
import { commandQuery, matchCommands, type SlashCommand } from './commands'

export interface CommandMenuState {
  open: boolean
  items: SlashCommand[]
  at: number
  listId: string
  listRef: RefObject<HTMLUListElement | null>
  field: {
    role: 'combobox'
    'aria-expanded': boolean
    'aria-haspopup': 'listbox'
    'aria-autocomplete': 'list'
    'aria-controls'?: string
    'aria-activedescendant'?: string
  }
  /** Returns true when the menu consumed the key. */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean
  choose: (index: number) => void
  hover: (index: number) => void
  close: () => void
}

export function useCommandMenu({
  commands,
  draft,
  onAccept,
}: {
  commands: readonly SlashCommand[]
  draft: string
  onAccept: (command: SlashCommand) => void
}): CommandMenuState {
  const [at, setAt] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const listId = useId()
  const list = useRef<HTMLUListElement>(null)

  const query = commandQuery(draft)
  const [was, setWas] = useState(query)
  if (query !== was) {
    setWas(query)
    setAt(0)
    setDismissed(false)
  }

  const items = query === null ? [] : matchCommands(commands, query)
  const open = query !== null && !dismissed && items.length > 0
  const active = items.length ? Math.min(at, items.length - 1) : -1

  useEffect(() => {
    if (!open || active < 0) return
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (index: number): void => {
    const command = items[index]
    if (command) onAccept(command)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setAt((held) => (Math.min(held, items.length - 1) + step + items.length) % items.length)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissed(true)
      return true
    }
    if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing)) {
      event.preventDefault()
      choose(active)
      return true
    }
    return false
  }

  return {
    open,
    items,
    at: active,
    listId,
    listRef: list,
    field: {
      role: 'combobox',
      'aria-haspopup': 'listbox',
      'aria-autocomplete': 'list',
      'aria-expanded': open,
      ...(open ? { 'aria-controls': listId } : {}),
      ...(open && active >= 0 ? { 'aria-activedescendant': `${listId}-o${active}` } : {}),
    },
    onKeyDown,
    choose,
    hover: setAt,
    close: () => setDismissed(true),
  }
}

export function CommandMenu({ menu }: { menu: CommandMenuState }) {
  // Keep the last list while it animates closed.
  const last = useRef<SlashCommand[]>([])
  if (menu.items.length) last.current = menu.items
  const items = menu.open ? menu.items : last.current

  return (
    <div
      aria-hidden={!menu.open}
      className={cn(
        'absolute inset-x-0 bottom-[calc(100%+6px)] z-30 overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-2xl',
        'origin-bottom transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
        menu.open ? 'translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-2 scale-[0.98] opacity-0',
      )}
    >
      <ul id={menu.listId} ref={menu.listRef} role="listbox" aria-label="Slash commands" className="max-h-64 overflow-y-auto py-1!">
        {items.map((command, index) => {
          const chosen = menu.open && index === menu.at
          return (
            <li
              key={command.name}
              id={`${menu.listId}-o${index}`}
              role="option"
              aria-selected={chosen}
              onMouseMove={() => menu.hover(index)}
              onMouseDown={(event) => {
                event.preventDefault()
                menu.choose(index)
              }}
              className={cn('flex cursor-pointer items-baseline gap-2 px-3! py-1.5! text-[12.5px]', chosen && 'bg-accent/15')}
            >
              <span className="shrink-0 font-mono text-[12px] text-text">{command.name}</span>
              {command.args ? <span className="shrink-0 font-mono text-[11px] text-text-muted">{command.args}</span> : null}
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-muted">{command.description}</span>
              {command.handledBy === 'panel' ? (
                <span className="shrink-0 rounded border border-accent/40 px-1! text-[9.5px] uppercase tracking-wide text-accent">
                  here
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      <p className="border-t border-border bg-bg-tertiary px-3! py-1.5! text-[10.5px] text-text-muted">
        ↑↓ to move · Enter or Tab to choose · Esc to close
      </p>
    </div>
  )
}

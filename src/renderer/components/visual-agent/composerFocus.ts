// "Type anywhere": a printable keystroke made while focus is nowhere (on
// <body>, or inside this panel on something that does not take typing) goes
// into the composer, and a plain click on the conversation focuses it —
// without stealing a click that ended a text selection or hit a control.
// Ported from Jef's `composerFocus.ts`.

import { useEffect, useRef, type MouseEvent } from 'react'
import { ownsClick, takesTyping, typedKey } from './composerKeys'

const SLOP = 4

export interface ComposerFocus {
  onMouseDown: (event: MouseEvent<HTMLElement>) => void
  onClick: (event: MouseEvent<HTMLElement>) => void
}

export function useComposerFocus({
  composer,
  root,
  onCharacter,
  enabled = true,
}: {
  composer: { current: HTMLTextAreaElement | null }
  /** The panel element; keystrokes aimed elsewhere in the app are left alone. */
  root: { current: HTMLElement | null }
  onCharacter: (character: string) => void
  enabled?: boolean
}): ComposerFocus {
  const pressed = useRef<{ x: number; y: number } | null>(null)
  const append = useRef(onCharacter)
  append.current = onCharacter
  const live = useRef(enabled)
  live.current = enabled

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!live.current || event.defaultPrevented) return
      if (takesTyping(document.activeElement)) return
      if (document.querySelector('[aria-modal="true"]')) return
      const target = event.target
      const away =
        target instanceof Element &&
        target !== document.body &&
        target !== document.documentElement &&
        !(root.current?.contains(target) ?? false)
      if (away) return
      // A keystroke on a control inside the panel (a focused button) is the control's.
      if (target instanceof Element && target !== document.body && target.closest('button, a[href], [role="option"]')) return
      const character = typedKey(event)
      if (character === null) return
      const box = composer.current
      if (!box || box.disabled) return
      box.focus()
      if (document.activeElement !== box) return
      event.preventDefault()
      append.current(character)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [composer, root])

  return {
    onMouseDown: (event) => {
      pressed.current = { x: event.clientX, y: event.clientY }
    },
    onClick: (event) => {
      const from = pressed.current
      pressed.current = null
      if (!live.current || !from) return
      if (Math.abs(event.clientX - from.x) > SLOP || Math.abs(event.clientY - from.y) > SLOP) return
      const selection = window.getSelection?.()
      if (selection && !selection.isCollapsed) return
      if (ownsClick(event.target, event.currentTarget)) return
      composer.current?.focus()
    },
  }
}

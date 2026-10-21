// Pure keyboard judgements for the composer and the "type anywhere" routing.

export interface KeyPress {
  key: string
  shiftKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  /** True while an IME is part-way through a word. */
  isComposing?: boolean
  /** 229 is what some browsers report for keys an IME has swallowed. */
  keyCode?: number
}

export type ComposerKeyAction = 'send' | 'fork' | 'interrupt' | null

/**
 * What a keydown in the composer textarea should do. Enter sends, Shift+Enter
 * is a newline (the default), ⌘/Ctrl+Enter asks aside in a fork, Esc while a
 * turn runs interrupts it. Nothing fires mid-IME composition.
 */
export const composerKeyAction = (event: KeyPress, state: { running: boolean }): ComposerKeyAction => {
  if (event.isComposing || event.keyCode === 229) return null
  if (event.key === 'Enter') {
    if (event.shiftKey || event.altKey) return null
    if (event.metaKey || event.ctrlKey) return 'fork'
    return 'send'
  }
  if (event.key === 'Escape' && state.running && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    return 'interrupt'
  }
  return null
}

/** The character a keystroke should put in the composer, or null. Modifiers mean commands. */
export const typedKey = ({ key, metaKey, ctrlKey, altKey, isComposing }: KeyPress): string | null => {
  if (isComposing) return null
  if (metaKey || ctrlKey || altKey) return null
  return key.length === 1 ? key : null
}

const TYPED_INTO = 'input, textarea, select, [contenteditable]'

/** Whether focus is already somewhere that takes typing. */
export const takesTyping = (node: EventTarget | null): boolean =>
  node instanceof Element && node.closest(TYPED_INTO) !== null

const OWNS_CLICK = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'pre',
  'code',
  'table',
  '[contenteditable]',
  '[tabindex]',
  '[role="button"]',
  '[role="dialog"]',
  '[role="listbox"]',
  '[role="option"]',
  '[data-keeps-focus]',
].join(', ')

/** Whether a click landed on something that is already about something (within root). */
export const ownsClick = (target: EventTarget | null, root: Element): boolean => {
  if (!(target instanceof Element)) return false
  const hit = target.closest(OWNS_CLICK)
  return hit !== null && hit !== root && root.contains(hit)
}

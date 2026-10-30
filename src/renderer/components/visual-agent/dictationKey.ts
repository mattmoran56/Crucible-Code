// Smart dictation: tells a dictation paste from one you made yourself. Dictation
// apps on macOS are driven by the Fn (globe) key — held while you speak, or
// tapped twice to start and once more to stop — and paste what you said a
// moment after the last press. So a paste only counts as dictation when the Fn
// key went down or up shortly before it. Each Fn press covers one paste, and
// typing in between cancels it, so a Cmd+V of your own a few seconds after
// dictating still waits for Enter.

/** How long after the last Fn press a paste still counts as dictation (transcription can lag). */
export const DICTATION_KEY_WINDOW_MS = 10_000

export interface KeyLike {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'OS', 'CapsLock', 'AltGraph'])

export function isDictationKey(event: KeyLike): boolean {
  return event.key === 'Fn' || event.code === 'Fn'
}

/** The keystrokes a dictation app sends to paste (Cmd/Ctrl+V), which must not cancel the press. */
function isPasteChord(event: KeyLike): boolean {
  return (event.metaKey || event.ctrlKey) === true && event.key.toLowerCase() === 'v'
}

export interface DictationKeyTracker {
  /** Feed every keydown/keyup seen by the window. */
  onKey: (event: KeyLike, now: number) => void
  /** True when a paste now follows a recent Fn press; uses that press up. */
  consume: (now: number) => boolean
}

export function createDictationKeyTracker(windowMs = DICTATION_KEY_WINDOW_MS): DictationKeyTracker {
  let pressedAt: number | null = null
  return {
    onKey: (event, now) => {
      if (isDictationKey(event)) {
        pressedAt = now
        return
      }
      if (MODIFIERS.has(event.key) || isPasteChord(event)) return
      // Fn+Delete, Fn+arrows and plain typing mean you are at the keyboard, not dictating.
      pressedAt = null
    },
    consume: (now) => {
      const recent = pressedAt !== null && now - pressedAt <= windowMs
      pressedAt = null
      return recent
    },
  }
}

let shared: DictationKeyTracker | null = null

/** The app-wide tracker, listening on the window from first use. */
export function dictationKeyTracker(): DictationKeyTracker {
  if (shared) return shared
  const tracker = createDictationKeyTracker()
  if (typeof window !== 'undefined') {
    const listen = (event: KeyboardEvent): void => tracker.onKey(event, Date.now())
    window.addEventListener('keydown', listen, true)
    window.addEventListener('keyup', listen, true)
  }
  shared = tracker
  return tracker
}

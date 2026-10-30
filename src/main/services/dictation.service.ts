// Smart dictation: tells a dictation app's paste from one of your own by the
// clipboard. Wispr Flow (and other well-behaved apps that paste on your behalf)
// put the text on the clipboard marked with the nspasteboard.org "concealed" or
// "transient" type, paste, then put your old clipboard back about half a
// second later. A clipboard you copied yourself carries neither mark.

import { clipboard } from 'electron'

export const DICTATION_CLIPBOARD_MARKERS = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
] as const

export function isDictatedClipboard(has: (format: string) => boolean): boolean {
  return DICTATION_CLIPBOARD_MARKERS.some((format) => {
    try {
      return has(format)
    } catch {
      return false
    }
  })
}

/** Whether what's on the clipboard right now was put there by a dictation app. */
export function isDictatedPaste(): boolean {
  return isDictatedClipboard((format) => clipboard.has(format))
}

import { handle } from './handle'
import { IPC } from '../../shared/constants'
import { isDictatedPaste } from '../services/dictation.service'

export function registerDictationHandlers(): void {
  handle(IPC.DICTATION_IS_DICTATED_PASTE, async () => isDictatedPaste())
}

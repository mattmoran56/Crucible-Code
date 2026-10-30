import { describe, expect, it } from 'vitest'
import {
  createDictationKeyTracker,
  DICTATION_KEY_WINDOW_MS,
} from '../../../../src/renderer/components/visual-agent/dictationKey'

const FN = { key: 'Fn', code: 'Fn' }

describe('createDictationKeyTracker', () => {
  it('a paste with no Fn press is not dictation', () => {
    expect(createDictationKeyTracker().consume(1000)).toBe(false)
  })

  it('holding Fn and letting go: the paste after release is dictation', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    tracker.onKey(FN, 4000)
    expect(tracker.consume(5500)).toBe(true)
  })

  it('double tap to start, tap to stop: counts from the last press', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    tracker.onKey(FN, 200)
    tracker.onKey(FN, 30_000)
    expect(tracker.consume(31_000)).toBe(true)
  })

  it('the Cmd+V a dictation app sends does not cancel the press', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    tracker.onKey({ key: 'Meta', metaKey: true }, 100)
    tracker.onKey({ key: 'v', metaKey: true }, 110)
    tracker.onKey({ key: 'V', ctrlKey: true }, 120)
    expect(tracker.consume(130)).toBe(true)
  })

  it('a press too long ago no longer counts', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    expect(tracker.consume(DICTATION_KEY_WINDOW_MS + 1)).toBe(false)
  })

  it('typing after the press cancels it', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    tracker.onKey({ key: 'a' }, 50)
    expect(tracker.consume(100)).toBe(false)
  })

  it('each press covers one paste', () => {
    const tracker = createDictationKeyTracker()
    tracker.onKey(FN, 0)
    expect(tracker.consume(100)).toBe(true)
    expect(tracker.consume(200)).toBe(false)
  })
})

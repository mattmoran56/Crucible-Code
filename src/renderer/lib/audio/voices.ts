// Kokoro-82M v1.0's English voices, as kokoro-js lists them. Kept here (not
// read from the engine) so Settings can offer them without loading the model.

import type { TtsVoice } from './engine'

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

const v = (id: string, name: string, grade: string): TtsVoice => ({
  id,
  name,
  language: id.startsWith('b') ? 'en-GB' : 'en-US',
  gender: id[1] === 'f' ? 'Female' : 'Male',
  grade,
})

export const KOKORO_VOICES: readonly TtsVoice[] = [
  v('af_heart', 'Heart', 'A'),
  v('af_bella', 'Bella', 'A-'),
  v('af_nicole', 'Nicole', 'B-'),
  v('af_aoede', 'Aoede', 'C+'),
  v('af_kore', 'Kore', 'C+'),
  v('af_sarah', 'Sarah', 'C+'),
  v('af_alloy', 'Alloy', 'C'),
  v('af_nova', 'Nova', 'C'),
  v('af_sky', 'Sky', 'C-'),
  v('af_jessica', 'Jessica', 'D'),
  v('af_river', 'River', 'D'),
  v('am_fenrir', 'Fenrir', 'C+'),
  v('am_michael', 'Michael', 'C+'),
  v('am_puck', 'Puck', 'C+'),
  v('am_echo', 'Echo', 'D'),
  v('am_eric', 'Eric', 'D'),
  v('am_liam', 'Liam', 'D'),
  v('am_onyx', 'Onyx', 'D'),
  v('am_adam', 'Adam', 'F+'),
  v('bf_emma', 'Emma', 'B-'),
  v('bf_isabella', 'Isabella', 'C'),
  v('bf_alice', 'Alice', 'D'),
  v('bf_lily', 'Lily', 'D'),
  v('bm_fable', 'Fable', 'C'),
  v('bm_george', 'George', 'C'),
  v('bm_daniel', 'Daniel', 'D'),
  v('bm_lewis', 'Lewis', 'D+'),
]

/** The natural-sounding default: Kokoro's best-graded voice. */
export const DEFAULT_VOICE = 'af_heart'

export const isKnownVoice = (id: unknown): id is string =>
  typeof id === 'string' && KOKORO_VOICES.some((voice) => voice.id === id)

export const voiceLabel = (voice: TtsVoice): string =>
  `${voice.name} (${voice.language === 'en-GB' ? 'UK' : 'US'}, ${voice.gender.toLowerCase()})`

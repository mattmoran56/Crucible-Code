// The text-to-speech engine contract. Kokoro-82M (kokoro-js, in a Web Worker)
// is the only implementation today; the interface is kept small so another
// engine (e.g. an opt-in "expressive" Chatterbox Turbo sidecar) can slot in.

export type TtsBackend = 'webgpu' | 'wasm'

export interface TtsVoice {
  id: string
  name: string
  /** BCP 47-ish accent tag: 'en-US' or 'en-GB'. */
  language: 'en-US' | 'en-GB'
  gender: 'Female' | 'Male'
  /** Kokoro's own quality grade (A best). */
  grade: string
}

export interface DownloadProgress {
  /** Bytes fetched so far across every model file. */
  loaded: number
  /** Total bytes, once every file's size is known (0 until then). */
  total: number
  /** The file in flight. */
  file: string | null
}

export interface EngineInfo {
  backend: TtsBackend
  dtype: string
  /** How long loading took (download included on a first run). */
  loadMs: number
}

export interface SpeakOptions {
  voice: string
  /** 1 = normal. */
  speed: number
}

/** One sentence of generated speech. */
export interface AudioChunk {
  /** The text it says (after cleanup). */
  text: string
  /** Mono PCM samples in [-1, 1]. */
  samples: Float32Array
  sampleRate: number
  /** Time spent generating it, for the real-time factor. */
  genMs: number
}

export interface TtsEngine {
  /** Load (downloading on first use) the model. Resolves once it can speak. */
  init(onProgress?: (progress: DownloadProgress) => void): Promise<EngineInfo>
  /**
   * Speak a stream of sentences as they arrive: yields audio a sentence at a
   * time, in order, and ends once the text stream ends and everything has
   * been generated (or `stop` is called).
   */
  speak(text: AsyncIterable<string>, options: SpeakOptions): AsyncIterable<AudioChunk>
  /** Abandon whatever is being generated. */
  stop(): void
  listVoices(): readonly TtsVoice[]
  /** Free the engine (worker, GPU memory). */
  dispose(): void
}

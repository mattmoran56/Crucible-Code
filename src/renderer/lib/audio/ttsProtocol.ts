// Messages between KokoroEngine (page) and tts.worker (Web Worker).

import type { TtsBackend } from './engine'

export type ToWorker =
  | { type: 'init'; modelId: string; /** Force the WASM backend (e.g. after a WebGPU failure). */ forceWasm?: boolean }
  | { type: 'speak'; id: number; voice: string; speed: number }
  | { type: 'text'; id: number; text: string }
  | { type: 'end'; id: number }
  | { type: 'stop'; id: number }

export type FromWorker =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'ready'; backend: TtsBackend; dtype: string; loadMs: number }
  | { type: 'audio'; id: number; text: string; samples: Float32Array; sampleRate: number; genMs: number }
  | { type: 'done'; id: number }
  | { type: 'error'; id?: number; message: string }

/** WebGPU runs Kokoro in full precision; WASM uses the 8-bit quantised weights. */
export const DTYPE: Record<TtsBackend, 'fp32' | 'q8'> = { webgpu: 'fp32', wasm: 'q8' }

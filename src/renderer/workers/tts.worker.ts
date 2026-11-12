/// <reference lib="webworker" />
// Kokoro-82M text-to-speech, off the main thread. Loaded only when audio out
// is switched on (KokoroEngine creates this worker on demand).
//
// WebGPU (fp32) when the GPU adapter is available, else WASM (q8). Each speak
// request feeds sentences into kokoro-js's TextSplitterStream and generates
// with tts.stream(), posting every sentence's audio back as soon as it is
// ready, so playback can start on the first one.

import { KokoroTTS, TextSplitterStream } from 'kokoro-js'
import { env } from '@huggingface/transformers'
// onnxruntime's WASM runtime, bundled with the app. transformers.js otherwise
// fetches it from a CDN at run time, which fails offline.
import ortMjsUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url'
import ortWasmUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url'
import { modelCache } from '../lib/audio/modelCache'
import { DTYPE, type FromWorker, type ToWorker } from '../lib/audio/ttsProtocol'
import type { TtsBackend } from '../lib/audio/engine'

declare const self: DedicatedWorkerGlobalScope

// Cache model files in our IndexedDB store (see modelCache.ts), never on disk
// beside the app, and only ever fetch them from the Hugging Face Hub.
env.allowLocalModels = false
env.useBrowserCache = false
env.useCustomCache = true
env.customCache = modelCache
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl }

const post = (msg: FromWorker, transfer: Transferable[] = []): void => self.postMessage(msg, transfer)

let tts: KokoroTTS | null = null
let loading: Promise<void> | null = null

interface Job {
  id: number
  splitter: TextSplitterStream
  cancelled: boolean
  closed: boolean
  /** When each pushed sentence arrived, to time generation without the wait for text. */
  pushedAt: number[]
}
let job: Job | null = null
/** Generation is serialised: a new speak waits for the previous loop to wind down. */
let queue: Promise<void> = Promise.resolve()

/** TextSplitterStream throws on a second close. */
function closeJob(target: Job): void {
  if (target.closed) return
  target.closed = true
  target.splitter.close()
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return !!gpu && !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function load(modelId: string, forceWasm: boolean): Promise<void> {
  const started = performance.now()
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 })
  }
  let backend: TtsBackend = !forceWasm && (await hasWebGpu()) ? 'webgpu' : 'wasm'
  try {
    tts = await KokoroTTS.from_pretrained(modelId, { dtype: DTYPE[backend], device: backend, progress_callback })
  } catch (err) {
    if (backend !== 'webgpu') throw err
    console.warn('[tts] WebGPU failed, falling back to WASM:', err)
    backend = 'wasm'
    tts = await KokoroTTS.from_pretrained(modelId, { dtype: DTYPE.wasm, device: 'wasm', progress_callback })
  }
  post({ type: 'ready', backend, dtype: DTYPE[backend], loadMs: Math.round(performance.now() - started) })
}

async function run(current: Job, voice: string, speed: number): Promise<void> {
  if (!tts) throw new Error('The voice model is not loaded')
  let last = performance.now()
  let index = 0
  const stream = tts.stream(current.splitter, { voice: voice as never, speed })
  for await (const { text, audio } of stream) {
    if (current.cancelled) break
    const now = performance.now()
    // Generation began when both the previous sentence was done and this one had arrived.
    const began = Math.max(last, current.pushedAt[index] ?? last)
    index++
    last = now
    const samples = audio.audio as Float32Array
    post(
      { type: 'audio', id: current.id, text, samples, sampleRate: audio.sampling_rate, genMs: Math.round(now - began) },
      [samples.buffer],
    )
  }
}

self.onmessage = (event: MessageEvent<ToWorker>): void => {
  const msg = event.data
  switch (msg.type) {
    case 'init': {
      if (tts) {
        post({ type: 'error', message: 'already loaded' })
        return
      }
      loading ??= load(msg.modelId, msg.forceWasm === true).catch((err: unknown) => {
        loading = null
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
      return
    }
    case 'speak': {
      if (job) {
        job.cancelled = true
        closeJob(job)
      }
      const current: Job = { id: msg.id, splitter: new TextSplitterStream(), cancelled: false, closed: false, pushedAt: [] }
      job = current
      queue = queue
        .then(() => (current.cancelled ? undefined : run(current, msg.voice, msg.speed)))
        .catch((err: unknown) => post({ type: 'error', id: current.id, message: err instanceof Error ? err.message : String(err) }))
        .then(() => {
          if (job === current) job = null
          post({ type: 'done', id: current.id })
        })
      return
    }
    case 'text': {
      if (job?.id !== msg.id || job.cancelled || job.closed) return
      job.pushedAt.push(performance.now())
      // Each message is already a whole sentence (SentenceChunker). The
      // splitter would otherwise hold a sentence back until the next one
      // begins, so flush it straight through.
      job.splitter.push(msg.text)
      job.splitter.flush()
      return
    }
    case 'end': {
      if (job?.id === msg.id) closeJob(job)
      return
    }
    case 'stop': {
      if (job?.id === msg.id) {
        job.cancelled = true
        closeJob(job)
      }
      return
    }
  }
}

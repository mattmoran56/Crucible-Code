// TtsEngine over Kokoro-82M in a Web Worker (tts.worker.ts). This module is
// only ever imported dynamically, once audio out is switched on, so neither
// kokoro-js nor the worker loads while the feature is off.

import { AsyncQueue } from './asyncQueue'
import type { AudioChunk, DownloadProgress, EngineInfo, SpeakOptions, TtsEngine, TtsVoice } from './engine'
import type { FromWorker, ToWorker } from './ttsProtocol'
import { KOKORO_MODEL_ID, KOKORO_VOICES } from './voices'

export type WorkerFactory = () => Worker

const defaultWorker: WorkerFactory = () =>
  new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), { type: 'module', name: 'kokoro-tts' })

/** Sums per-file progress into one figure across the model's files. */
export class ProgressTally {
  private files = new Map<string, { loaded: number; total: number }>()

  add(file: string, loaded: number, total: number): DownloadProgress {
    this.files.set(file, { loaded, total })
    let sumLoaded = 0
    let sumTotal = 0
    for (const f of this.files.values()) {
      sumLoaded += f.loaded
      sumTotal += f.total
    }
    return { loaded: sumLoaded, total: sumTotal, file }
  }
}

export class KokoroEngine implements TtsEngine {
  private worker: Worker | null = null
  private ready: Promise<EngineInfo> | null = null
  private nextId = 0
  private current: { id: number; out: AsyncQueue<AudioChunk>; error: Error | null; finished: boolean } | null = null

  constructor(
    private readonly makeWorker: WorkerFactory = defaultWorker,
    /** Skip WebGPU even when an adapter exists (diagnostics, broken drivers). */
    private readonly forceWasm = false,
  ) {}

  init(onProgress?: (progress: DownloadProgress) => void): Promise<EngineInfo> {
    if (this.ready) return this.ready
    const worker = this.makeWorker()
    this.worker = worker
    const tally = new ProgressTally()
    this.ready = new Promise<EngineInfo>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const msg = event.data
        switch (msg.type) {
          case 'progress':
            onProgress?.(tally.add(msg.file, msg.loaded, msg.total))
            return
          case 'ready':
            resolve({ backend: msg.backend, dtype: msg.dtype, loadMs: msg.loadMs })
            return
          case 'audio':
            if (this.current?.id === msg.id) {
              this.current.out.push({ text: msg.text, samples: msg.samples, sampleRate: msg.sampleRate, genMs: msg.genMs })
            }
            return
          case 'done':
            if (this.current?.id === msg.id) {
              this.current.finished = true
              this.current.out.close()
            }
            return
          case 'error':
            if (msg.id === undefined) {
              reject(new Error(msg.message))
            } else if (this.current?.id === msg.id) {
              this.current.error = new Error(msg.message)
              this.current.out.close()
            }
            return
        }
      }
      worker.onerror = (event) => reject(new Error(event.message || 'The voice engine failed to start'))
    })
    this.ready.catch(() => {
      // A failed load can be retried from scratch.
      this.dispose()
    })
    this.send({ type: 'init', modelId: KOKORO_MODEL_ID, ...(this.forceWasm ? { forceWasm: true } : {}) })
    return this.ready
  }

  async *speak(text: AsyncIterable<string>, options: SpeakOptions): AsyncIterable<AudioChunk> {
    await this.init()
    this.stop()
    const id = ++this.nextId
    const job = { id, out: new AsyncQueue<AudioChunk>(), error: null as Error | null, finished: false }
    this.current = job
    this.send({ type: 'speak', id, voice: options.voice, speed: options.speed })

    // Forward sentences while audio streams back.
    void (async () => {
      try {
        for await (const sentence of text) {
          if (this.current !== job) return
          this.send({ type: 'text', id, text: sentence })
        }
      } finally {
        if (this.current === job) this.send({ type: 'end', id })
      }
    })()

    try {
      for await (const chunk of job.out) yield chunk
      if (job.error) throw job.error
    } finally {
      if (this.current === job) {
        // Left early (the consumer stopped listening): the worker can stop too.
        if (!job.finished) this.send({ type: 'stop', id })
        this.current = null
      }
    }
  }

  stop(): void {
    const job = this.current
    if (!job) return
    this.current = null
    this.send({ type: 'stop', id: job.id })
    job.out.abort()
  }

  listVoices(): readonly TtsVoice[] {
    return KOKORO_VOICES
  }

  dispose(): void {
    this.stop()
    this.worker?.terminate()
    this.worker = null
    this.ready = null
  }

  private send(msg: ToWorker): void {
    this.worker?.postMessage(msg)
  }
}

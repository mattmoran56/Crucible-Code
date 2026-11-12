import { describe, expect, it } from 'vitest'
import { AsyncQueue } from '../../../../src/renderer/lib/audio/asyncQueue'
import { KokoroEngine, ProgressTally } from '../../../../src/renderer/lib/audio/kokoroEngine'
import type { FromWorker, ToWorker } from '../../../../src/renderer/lib/audio/ttsProtocol'
import { formatBytes } from '../../../../src/renderer/lib/audio/modelCache'
import { DEFAULT_VOICE, KOKORO_VOICES, isKnownVoice, voiceLabel } from '../../../../src/renderer/lib/audio/voices'

const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('AsyncQueue', () => {
  it('delivers pushed items in order and ends on close', async () => {
    const q = new AsyncQueue<number>()
    const got: number[] = []
    const done = (async () => {
      for await (const n of q) got.push(n)
    })()
    q.push(1)
    q.push(2)
    await tick()
    q.push(3)
    q.close()
    q.push(4) // ignored after close
    await done
    expect(got).toEqual([1, 2, 3])
  })

  it('abort drops what is queued', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.abort()
    const got: number[] = []
    for await (const n of q) got.push(n)
    expect(got).toEqual([])
    expect(q.isClosed).toBe(true)
  })
})

describe('ProgressTally', () => {
  it('sums progress across files', () => {
    const t = new ProgressTally()
    expect(t.add('config.json', 10, 10)).toEqual({ loaded: 10, total: 10, file: 'config.json' })
    expect(t.add('model.onnx', 50, 100)).toEqual({ loaded: 60, total: 110, file: 'model.onnx' })
    expect(t.add('model.onnx', 100, 100)).toEqual({ loaded: 110, total: 110, file: 'model.onnx' })
  })
})

/** A stand-in worker that answers the way tts.worker does. */
class FakeWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  sent: ToWorker[] = []
  terminated = false
  reply(msg: FromWorker) {
    this.onmessage?.({ data: msg } as MessageEvent<FromWorker>)
  }
  postMessage(msg: ToWorker) {
    this.sent.push(msg)
    if (msg.type === 'init') {
      queueMicrotask(() => {
        this.reply({ type: 'progress', file: 'onnx/model_quantized.onnx', loaded: 5, total: 10 })
        this.reply({ type: 'ready', backend: 'wasm', dtype: 'q8', loadMs: 42 })
      })
    }
    if (msg.type === 'text') {
      const id = msg.id
      queueMicrotask(() =>
        this.reply({ type: 'audio', id, text: msg.text, samples: new Float32Array(10), sampleRate: 24000, genMs: 3 }),
      )
    }
    if (msg.type === 'end') {
      const id = msg.id
      setTimeout(() => this.reply({ type: 'done', id }), 0)
    }
  }
  terminate() {
    this.terminated = true
  }
}

describe('KokoroEngine', () => {
  it('loads once, reporting progress and the backend', async () => {
    const worker = new FakeWorker()
    let made = 0
    const engine = new KokoroEngine(() => {
      made++
      return worker as unknown as Worker
    })
    const progress: number[] = []
    const info = await engine.init((p) => progress.push(p.loaded))
    expect(info).toEqual({ backend: 'wasm', dtype: 'q8', loadMs: 42 })
    expect(progress).toEqual([5])
    await engine.init()
    expect(made).toBe(1)
    expect(worker.sent[0]).toEqual({ type: 'init', modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX' })
  })

  it('streams sentences to the worker and audio back', async () => {
    const worker = new FakeWorker()
    const engine = new KokoroEngine(() => worker as unknown as Worker)
    const text = new AsyncQueue<string>()
    const got: string[] = []
    const done = (async () => {
      for await (const chunk of engine.speak(text, { voice: 'af_heart', speed: 1 })) got.push(chunk.text)
    })()
    await tick()
    text.push('One.')
    text.push('Two.')
    await tick()
    expect(got).toEqual(['One.', 'Two.'])
    text.close()
    await done
    const types = worker.sent.map((m) => m.type)
    expect(types).toEqual(['init', 'speak', 'text', 'text', 'end'])
    expect(worker.sent[1]).toMatchObject({ type: 'speak', voice: 'af_heart', speed: 1 })
  })

  it('stop ends the stream and tells the worker', async () => {
    const worker = new FakeWorker()
    const engine = new KokoroEngine(() => worker as unknown as Worker)
    const text = new AsyncQueue<string>()
    const done = (async () => {
      const out: string[] = []
      for await (const chunk of engine.speak(text, { voice: 'af_heart', speed: 1 })) out.push(chunk.text)
      return out
    })()
    await tick()
    engine.stop()
    expect(await done).toEqual([])
    expect(worker.sent.some((m) => m.type === 'stop')).toBe(true)
  })

  it('rejects a failed load and can start again', async () => {
    const workers: FakeWorker[] = []
    const engine = new KokoroEngine(() => {
      const w = new FakeWorker()
      w.postMessage = (msg: ToWorker) => {
        w.sent.push(msg)
        if (msg.type === 'init') queueMicrotask(() => w.reply({ type: 'error', message: 'offline' }))
      }
      workers.push(w)
      return w as unknown as Worker
    })
    await expect(engine.init()).rejects.toThrow('offline')
    await tick()
    expect(workers[0].terminated).toBe(true)
    await expect(engine.init()).rejects.toThrow('offline')
    expect(workers).toHaveLength(2)
  })

  it('lists Kokoro voices', () => {
    expect(new KokoroEngine(() => new FakeWorker() as unknown as Worker).listVoices()).toBe(KOKORO_VOICES)
  })
})

describe('voices and sizes', () => {
  it('defaults to a known, top-graded English voice', () => {
    expect(isKnownVoice(DEFAULT_VOICE)).toBe(true)
    expect(KOKORO_VOICES.find((v) => v.id === DEFAULT_VOICE)?.grade).toBe('A')
    expect(isKnownVoice('zz_nobody')).toBe(false)
    expect(KOKORO_VOICES.every((v) => v.language === 'en-US' || v.language === 'en-GB')).toBe(true)
  })

  it('labels voices with accent and gender', () => {
    expect(voiceLabel(KOKORO_VOICES.find((v) => v.id === 'bm_george')!)).toBe('George (UK, male)')
    expect(voiceLabel(KOKORO_VOICES.find((v) => v.id === 'af_heart')!)).toBe('Heart (US, female)')
  })

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(92 * 1024 * 1024)).toBe('92 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

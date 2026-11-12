import { beforeEach, describe, expect, it } from 'vitest'
import type { AudioChunk, SpeakOptions, TtsEngine } from '../../../../src/renderer/lib/audio/engine'
import {
  LIVE_KEY,
  SpeechController,
  type PlayerLike,
  type SpeechSettings,
  type SpeechSnapshot,
} from '../../../../src/renderer/lib/audio/speechController'
import { KOKORO_VOICES } from '../../../../src/renderer/lib/audio/voices'

const tick = async (n = 5): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

class FakeEngine implements TtsEngine {
  spoken: string[] = []
  options: SpeakOptions[] = []
  stops = 0
  async init() {
    return { backend: 'wasm' as const, dtype: 'q8', loadMs: 1 }
  }
  async *speak(text: AsyncIterable<string>, options: SpeakOptions): AsyncIterable<AudioChunk> {
    this.options.push(options)
    for await (const sentence of text) {
      this.spoken.push(sentence)
      // One second of audio that took a quarter of a second to make.
      yield { text: sentence, samples: new Float32Array(24000), sampleRate: 24000, genMs: 250 }
    }
  }
  stop() {
    this.stops++
  }
  listVoices() {
    return KOKORO_VOICES
  }
  dispose() {}
}

class FakePlayer implements PlayerLike {
  chunks = 0
  stops = 0
  volume = 1
  playing = false
  enqueue(_samples: Float32Array, _rate: number, hooks: { onStart?: () => void; onIdle?: () => void } = {}) {
    this.chunks++
    hooks.onStart?.()
    hooks.onIdle?.()
    return 0
  }
  stop() {
    this.stops++
  }
  setVolume(v: number) {
    this.volume = v
  }
}

const A = 'sess-a:agent'
const B = 'sess-b:agent'
const PLAIN = 'sess-c:agent'

let engine: FakeEngine
let player: FakePlayer
let settings: SpeechSettings
let snapshots: SpeechSnapshot[]
let clock: number
let c: SpeechController

beforeEach(() => {
  engine = new FakeEngine()
  player = new FakePlayer()
  settings = { voice: 'bf_emma', speed: 1.25, volume: 0.5, codeBlocks: 'skip', stopOnTyping: true, stopOnSwitch: false }
  snapshots = []
  clock = 1000
  c = new SpeechController({
    engine: async () => engine,
    player,
    settings: () => settings,
    isAudioAgent: (id) => id !== PLAIN,
    onChange: (s) => snapshots.push(s),
    now: () => clock,
  })
})

/** Stream `text` into an agent as accumulated partials, a few characters at a time. */
async function stream(agentId: string, text: string, messageId = 'm1', step = 4): Promise<void> {
  for (let i = step; i < text.length + step; i += step) c.onPartial(agentId, 'main', messageId, text.slice(0, i))
  await tick()
}

describe('SpeechController — streaming', () => {
  it('speaks each sentence as soon as it is complete, with the chosen voice and speed', async () => {
    c.onPartial(A, 'main', 'm1', 'First sentence. Sec')
    await tick()
    expect(engine.spoken).toEqual(['First sentence.'])
    expect(engine.options[0]).toEqual({ voice: 'bf_emma', speed: 1.25 })
    expect(player.volume).toBe(0.5)
    c.onPartial(A, 'main', 'm1', 'First sentence. Second one!')
    c.onPartial(A, 'main', 'm1', '')
    await tick()
    expect(engine.spoken).toEqual(['First sentence.', 'Second one!'])
  })

  it('cleans each sentence for speech', async () => {
    await stream(A, '## Done\n\nI updated **src/a/b/Thing.tsx** ✅.\n\n```ts\nx()\n```\n\nAll set.')
    c.onPartial(A, 'main', 'm1', '')
    await tick()
    expect(engine.spoken).toEqual(['Done.', 'I updated Thing.tsx.', 'All set.'])
  })

  it('announces code blocks when set to', async () => {
    settings.codeBlocks = 'announce'
    await stream(A, 'Here:\n\n```\ncode\n```\n\nDone.')
    c.onPartial(A, 'main', 'm1', '')
    await tick()
    expect(engine.spoken).toEqual(['Here:', 'Code block omitted.', 'Done.'])
  })

  it('does not speak the final text event of a block it already streamed', async () => {
    await stream(A, 'Hello there. All good.')
    c.onPartial(A, 'main', 'm1', '')
    c.onAssistantText(A, 'main', 'Hello there. All good.')
    await tick()
    expect(engine.spoken).toEqual(['Hello there.', 'All good.'])
  })

  it('speaks a final text event that never streamed', async () => {
    c.onAssistantText(A, 'main', 'No partials. Just this.')
    await tick()
    expect(engine.spoken).toEqual(['No partials.', 'Just this.'])
  })

  it('ignores replayed history, sub-agent threads and non-audio agents', async () => {
    c.onAssistantText(A, 'main', 'Old news.', true)
    c.onPartial(A, 'toolu_sub', 'm9', 'Sub-agent chatter. More.')
    c.onAssistantText(A, 'toolu_sub', 'Sub-agent chatter.')
    c.onPartial(PLAIN, 'main', 'm2', 'Not audio. Nope.')
    c.onAssistantText(PLAIN, 'main', 'Not audio.')
    await tick()
    expect(engine.spoken).toEqual([])
  })

  it('keeps speaking across text blocks in one turn, then finishes', async () => {
    await stream(A, 'Looking now.', 'm1')
    c.onPartial(A, 'main', 'm1', '')
    c.onAssistantText(A, 'main', 'Looking now.')
    await stream(A, 'Found it. Fixed.', 'm2')
    c.onTurnEnd(A)
    await tick()
    expect(engine.spoken).toEqual(['Looking now.', 'Found it.', 'Fixed.'])
    expect(c.snapshot().speakingAgentId).toBeNull()
  })

  it('records time to first audio and real-time factor', async () => {
    c.onPartial(A, 'main', 'm1', 'One. Tw')
    clock = 1300
    await tick()
    c.onTurnEnd(A)
    await tick()
    const metrics = c.snapshot().metrics!
    expect(metrics.timeToFirstAudioMs).toBe(300)
    expect(metrics.realTimeFactor).toBe(0.25)
    expect(metrics.sentences).toBe(2)
  })
})

describe('SpeechController — one voice at a time', () => {
  it('does not let another agent interrupt', async () => {
    await stream(A, 'A is talking. Still A.')
    await stream(B, 'B wants in. Me too.', 'mb')
    expect(engine.spoken).toEqual(['A is talking.'])
    expect(c.snapshot().speakingAgentId).toBe(A)
  })

  it('hands the voice to a streaming reply in the session switched to', async () => {
    c.onActiveSession('sess-a')
    await stream(A, 'A is talking. Still A.')
    await stream(B, 'B wants in. Me too. And')
    c.onActiveSession('sess-b')
    await tick()
    expect(c.snapshot().speakingAgentId).toBe(B)
    expect(engine.spoken).toEqual(['A is talking.', 'B wants in.', 'Me too.'])
    c.onPartial(B, 'main', 'mb', 'B wants in. Me too. And more.')
    c.onTurnEnd(B)
    await tick()
    expect(engine.spoken.at(-1)).toBe('And more.')
  })

  it('keeps speaking when switching away, unless told to stop on switch', async () => {
    c.onActiveSession('sess-a')
    await stream(A, 'Talking here. More')
    c.onActiveSession('sess-z')
    expect(c.snapshot().speakingAgentId).toBe(A)

    settings.stopOnSwitch = true
    c.onActiveSession('sess-a')
    c.onActiveSession('sess-y')
    expect(c.snapshot().speakingAgentId).toBeNull()
    expect(player.stops).toBeGreaterThan(0)
  })

  it('lets the next agent speak once the current one has finished', async () => {
    await stream(A, 'Short.')
    c.onTurnEnd(A)
    await tick()
    await stream(B, 'My turn now. Yes', 'mb')
    expect(engine.spoken).toEqual(['Short.', 'My turn now.'])
  })
})

describe('SpeechController — stopping', () => {
  it('stops when the person types in the speaking agent, if set to', async () => {
    await stream(A, 'Talking. More talk. Even')
    c.onTyping(B)
    expect(c.snapshot().speakingAgentId).toBe(A)
    c.onTyping(A)
    expect(c.snapshot().speakingAgentId).toBeNull()
    expect(engine.stops).toBe(1)
    expect(player.stops).toBe(1)
  })

  it('keeps talking through typing when that setting is off', async () => {
    settings.stopOnTyping = false
    await stream(A, 'Talking. More')
    c.onTyping(A)
    expect(c.snapshot().speakingAgentId).toBe(A)
  })

  it('stops on send and drops the rest of that reply', async () => {
    await stream(A, 'Talking. More talk. Even')
    c.onSend(A)
    c.onPartial(A, 'main', 'm1', 'Talking. More talk. Even more. Yes')
    await tick()
    // The reply carries on streaming in the background but a new turn is what
    // the person wants to hear; only fresh replies speak after a stop.
    expect(engine.spoken.slice(0, 2)).toEqual(['Talking.', 'More talk.'])
  })

  it('mute stops and silences an agent until unmuted', async () => {
    await stream(A, 'Talking. More')
    c.setMuted(A, true)
    expect(c.snapshot().speakingAgentId).toBeNull()
    expect(c.isMuted(A)).toBe(true)
    c.onPartial(A, 'main', 'm1', 'Talking. More words. Next')
    await tick()
    expect(engine.spoken).toEqual(['Talking.'])
    c.setMuted(A, false)
    c.onPartial(A, 'main', 'm1', 'Talking. More words. Next one. Done')
    await tick()
    expect(engine.spoken.at(-1)).toBe('Next one.')
  })

  it('stop() silences everything', async () => {
    await stream(A, 'Talking. More')
    c.stop()
    expect(c.snapshot()).toMatchObject({ speakingAgentId: null, speakingKey: null })
  })
})

describe('SpeechController — replay and preview', () => {
  it('replays a whole message under its key, interrupting anything', async () => {
    await stream(B, 'B talking. More')
    c.replay(A, 'evt-1', '**Bold** claim. Then a link: https://example.com/x.')
    expect(c.snapshot()).toMatchObject({ speakingAgentId: A, speakingKey: 'evt-1' })
    await tick()
    expect(engine.spoken.slice(-2)).toEqual(['Bold claim.', 'Then a link: example.com.'])
    expect(c.snapshot().speakingKey).toBeNull()
  })

  it('previews a sample line', async () => {
    c.preview('Hello. This is a test.')
    await tick()
    expect(engine.spoken).toEqual(['Hello.', 'This is a test.'])
  })

  it('reports who is speaking as it changes', async () => {
    await stream(A, 'Hi. There')
    expect(snapshots.some((s) => s.speakingAgentId === A && s.speakingKey === LIVE_KEY)).toBe(true)
  })

  it('reports an engine failure and stops', async () => {
    const errors: string[] = []
    const failing = new SpeechController({
      engine: async () => {
        throw new Error('no model')
      },
      player,
      settings: () => settings,
      isAudioAgent: () => true,
      onChange: () => undefined,
      onError: (e) => errors.push(e.message),
    })
    failing.preview('Hello.')
    await tick()
    expect(errors).toEqual(['no model'])
    expect(failing.snapshot().speakingAgentId).toBeNull()
  })
})

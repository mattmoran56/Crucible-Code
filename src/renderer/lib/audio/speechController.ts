// Who speaks, what, and when. Fed the Agent tab's frames for audio-mode
// agents; turns streamed assistant prose into sentences, cleans each one, and
// hands them to the engine while the previous one plays.
//
// Rules (see the README's Audio out section):
// - Only the assistant's prose on the main thread is spoken: never tool calls,
//   tool results, thinking, permission prompts or sub-agent text.
// - One agent speaks at a time. A reply from another agent does not interrupt;
//   switching to that agent's session hands the voice over to it.
// - Speech stops when the person types in (setting) or sends to the speaking
//   agent, presses Esc / Stop, mutes it, or switches away (setting).

import { AsyncQueue } from './asyncQueue'
import type { SpeakOptions, TtsEngine } from './engine'
import { AccumulatedTextFeed, chunkSentences } from './sentences'
import { toSpeakableText, type CodeBlockSpeech } from './speakable'

export interface SpeechSettings {
  voice: string
  speed: number
  volume: number
  codeBlocks: CodeBlockSpeech
  stopOnTyping: boolean
  stopOnSwitch: boolean
}

export interface SpeechMetrics {
  /** First sentence ready → first audio heard, ms. */
  timeToFirstAudioMs: number | null
  /** Generation time ÷ audio duration (below 1 is faster than real time). */
  realTimeFactor: number | null
  sentences: number
}

export interface SpeechSnapshot {
  /** The agent whose reply is being spoken, or null. */
  speakingAgentId: string | null
  /** What is being spoken: 'live' for a streaming reply, else the replay key. */
  speakingKey: string | null
  /** The most recent utterance's numbers. */
  metrics: SpeechMetrics | null
}

/** The bits of AudioPlayer the controller uses (a fake in tests). */
export interface PlayerLike {
  enqueue(samples: Float32Array, sampleRate: number, hooks?: { onStart?: () => void; onIdle?: () => void }): number
  stop(): void
  setVolume(volume: number): void
  readonly playing: boolean
}

export interface SpeechDeps {
  /** The engine, initialised. Called only when there is something to say. */
  engine: () => Promise<TtsEngine>
  player: PlayerLike
  settings: () => SpeechSettings
  /** Whether this agent's session runs in audio mode. */
  isAudioAgent: (agentId: string) => boolean
  onChange: (snapshot: SpeechSnapshot) => void
  onError?: (error: Error) => void
  now?: () => number
}

export const LIVE_KEY = 'live'

const MAIN = 'main'

class Utterance {
  readonly text = new AsyncQueue<string>()
  firstTextAt: number | null = null
  firstAudioAt: number | null = null
  genMs = 0
  audioMs = 0
  sentences = 0
  generationDone = false
  stopped = false

  constructor(
    readonly agentId: string | null,
    readonly key: string,
  ) {}
}

interface AgentStream {
  feed: AccumulatedTextFeed
  messageId: string | null
  /** Chunks already cut from the current block (for a hand-over mid-reply). */
  blockChunks: string[]
  /** Text of blocks that finished streaming, so their final event isn't spoken twice. */
  streamed: string[]
}

const sessionOf = (agentId: string, sessionId: string): boolean => agentId.startsWith(`${sessionId}:`)

export class SpeechController {
  private current: Utterance | null = null
  private streams = new Map<string, AgentStream>()
  private muted = new Set<string>()
  private live = new Set<string>()
  private activeSessionId: string | null = null
  private lastMetrics: SpeechMetrics | null = null
  /** The engine once loaded, so a stop can reach it synchronously. */
  private engineRef: TtsEngine | null = null
  private readonly now: () => number

  constructor(private readonly deps: SpeechDeps) {
    this.now = deps.now ?? (() => performance.now())
  }

  /* --- what the Agent tab tells us ------------------------------------- */

  /** A streaming partial: the whole text of the block so far ('' = block over). */
  onPartial(agentId: string, threadId: string, messageId: string, text: string): void {
    if (threadId !== MAIN || !this.deps.isAudioAgent(agentId)) return
    const stream = this.stream(agentId)
    if (!text) {
      this.endBlock(agentId, stream)
      return
    }
    if (stream.messageId !== null && stream.messageId !== messageId && stream.feed.text) this.endBlock(agentId, stream)
    stream.messageId = messageId
    this.live.add(agentId)
    this.say(agentId, stream.feed.update(text), stream)
  }

  /** A finished assistant text block. Spoken whole only if it never streamed. */
  onAssistantText(agentId: string, threadId: string, text: string, replayed = false): void {
    if (replayed || threadId !== MAIN || !this.deps.isAudioAgent(agentId)) return
    const stream = this.stream(agentId)
    if (stream.feed.text) {
      this.endBlock(agentId, stream)
      return
    }
    const at = stream.streamed.findIndex((t) => t.trim() === text.trim())
    if (at >= 0) {
      stream.streamed.splice(at, 1)
      return
    }
    this.live.add(agentId)
    this.say(agentId, chunkSentences(text), stream)
  }

  /** The agent's turn ended (idle, done or failed): nothing more is coming. */
  onTurnEnd(agentId: string): void {
    const stream = this.streams.get(agentId)
    if (stream?.feed.text) this.endBlock(agentId, stream)
    this.live.delete(agentId)
    if (stream) {
      stream.blockChunks = []
      stream.streamed = []
    }
    if (this.current?.agentId === agentId && this.current.key === LIVE_KEY) this.current.text.close()
  }

  /** The person typed in this agent's composer. */
  onTyping(agentId: string): void {
    if (this.deps.settings().stopOnTyping) this.stopAgent(agentId)
  }

  /** The person sent this agent a message (or pressed Esc in its composer). */
  onSend(agentId: string): void {
    this.stopAgent(agentId)
  }

  /** The visible session changed. */
  onActiveSession(sessionId: string | null): void {
    if (sessionId === this.activeSessionId) return
    this.activeSessionId = sessionId
    const speaking = this.current
    if (!sessionId) return
    // A reply streaming in the session switched to takes the voice over.
    const incoming = [...this.live].find((id) => sessionOf(id, sessionId) && !this.muted.has(id))
    if (incoming && speaking?.agentId !== incoming) {
      this.stop()
      const stream = this.stream(incoming)
      this.say(incoming, [...stream.blockChunks], stream, true)
      return
    }
    if (speaking?.agentId && !sessionOf(speaking.agentId, sessionId) && this.deps.settings().stopOnSwitch) this.stop()
  }

  setMuted(agentId: string, muted: boolean): void {
    if (muted) {
      this.muted.add(agentId)
      this.stopAgent(agentId)
    } else {
      this.muted.delete(agentId)
    }
  }

  isMuted(agentId: string): boolean {
    return this.muted.has(agentId)
  }

  /* --- on demand -------------------------------------------------------- */

  /** Speak a whole message again (the replay button). Interrupts anything. */
  replay(agentId: string | null, key: string, text: string): void {
    this.stop()
    const utterance = this.begin(agentId, key)
    for (const chunk of this.clean(chunkSentences(text))) this.push(utterance, chunk)
    utterance.text.close()
  }

  /** Say a sample line (Settings → Preview). */
  preview(text: string): void {
    this.replay(null, 'preview', text)
  }

  /** Stop speaking, whoever it is. */
  stop(): void {
    const utterance = this.current
    if (!utterance) return
    utterance.stopped = true
    utterance.text.abort()
    this.current = null
    this.deps.player.stop()
    this.engineRef?.stop()
    this.emit()
  }

  /** Stop only if this agent is the one speaking. */
  stopAgent(agentId: string): void {
    if (this.current?.agentId === agentId) this.stop()
  }

  snapshot(): SpeechSnapshot {
    return {
      speakingAgentId: this.current?.agentId ?? null,
      speakingKey: this.current?.key ?? null,
      metrics: this.lastMetrics,
    }
  }

  /** Audio turned off: drop everything. */
  dispose(): void {
    this.stop()
    this.streams.clear()
    this.live.clear()
  }

  /* --- internals -------------------------------------------------------- */

  private stream(agentId: string): AgentStream {
    let stream = this.streams.get(agentId)
    if (!stream) {
      stream = { feed: new AccumulatedTextFeed(), messageId: null, blockChunks: [], streamed: [] }
      this.streams.set(agentId, stream)
    }
    return stream
  }

  private endBlock(agentId: string, stream: AgentStream): void {
    const text = stream.feed.text
    const rest = stream.feed.end()
    if (text) {
      stream.streamed.push(text)
      if (stream.streamed.length > 8) stream.streamed.shift()
    }
    stream.feed.reset()
    stream.messageId = null
    this.say(agentId, rest, stream)
    stream.blockChunks = []
  }

  /** New chunks from an agent: queued if it holds the voice (or can take it). */
  private say(agentId: string, chunks: string[], stream: AgentStream, force = false): void {
    if (chunks.length === 0 && !force) return
    stream.blockChunks.push(...(force ? [] : chunks))
    if (this.muted.has(agentId)) return
    let utterance = this.current
    if (!utterance || utterance.text.isClosed) {
      if (utterance && utterance.agentId !== agentId && !force) return // still finishing someone else's reply
      utterance = this.begin(agentId, LIVE_KEY)
    } else if (utterance.agentId !== agentId) {
      return // someone else is speaking: don't interrupt
    }
    for (const chunk of this.clean(chunks)) this.push(utterance, chunk)
  }

  private clean(chunks: string[]): string[] {
    const { codeBlocks } = this.deps.settings()
    return chunks.map((chunk) => toSpeakableText(chunk, { codeBlocks })).filter((text) => /[\p{L}\p{N}]/u.test(text))
  }

  private push(utterance: Utterance, text: string): void {
    if (utterance.firstTextAt === null) utterance.firstTextAt = this.now()
    utterance.text.push(text)
  }

  private begin(agentId: string | null, key: string): Utterance {
    if (this.current) this.stop()
    const utterance = new Utterance(agentId, key)
    this.current = utterance
    this.emit()
    void this.run(utterance)
    return utterance
  }

  private async run(utterance: Utterance): Promise<void> {
    const settings = this.deps.settings()
    const options: SpeakOptions = { voice: settings.voice, speed: settings.speed }
    this.deps.player.setVolume(settings.volume)
    try {
      const engine = await this.deps.engine()
      this.engineRef = engine
      if (utterance.stopped) return
      for await (const chunk of engine.speak(utterance.text, options)) {
        if (utterance.stopped) return
        utterance.sentences++
        utterance.genMs += chunk.genMs
        utterance.audioMs += (chunk.samples.length / chunk.sampleRate) * 1000
        this.deps.player.enqueue(chunk.samples, chunk.sampleRate, {
          onStart: () => {
            if (utterance.firstAudioAt === null) {
              utterance.firstAudioAt = this.now()
              this.record(utterance)
            }
          },
          onIdle: () => this.maybeFinish(utterance),
        })
      }
      utterance.generationDone = true
      this.record(utterance)
      this.maybeFinish(utterance)
    } catch (error) {
      if (utterance.stopped) return
      this.deps.onError?.(error instanceof Error ? error : new Error(String(error)))
      if (this.current === utterance) this.stop()
    }
  }

  private maybeFinish(utterance: Utterance): void {
    if (this.current !== utterance || !utterance.generationDone || this.deps.player.playing) return
    this.current = null
    this.emit()
  }

  private record(utterance: Utterance): void {
    this.lastMetrics = {
      timeToFirstAudioMs:
        utterance.firstAudioAt !== null && utterance.firstTextAt !== null
          ? Math.round(utterance.firstAudioAt - utterance.firstTextAt)
          : null,
      realTimeFactor: utterance.audioMs > 0 ? Math.round((utterance.genMs / utterance.audioMs) * 100) / 100 : null,
      sentences: utterance.sentences,
    }
    this.emit()
  }

  private emit(): void {
    this.deps.onChange(this.snapshot())
  }
}

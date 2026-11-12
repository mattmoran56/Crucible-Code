// Gapless playback of generated sentences through Web Audio: each chunk is
// scheduled to start exactly when the previous one ends, so a reply sounds
// continuous as long as generation keeps ahead of playback.

/** Head start given to the first chunk so scheduling never lands in the past. */
const LEAD_S = 0.03

export interface PlayerHooks {
  /** The first sample of a run of audio is about to be heard. */
  onStart?: () => void
  /** Everything scheduled has finished playing. */
  onIdle?: () => void
}

export class AudioPlayer {
  private ctx: AudioContext | null = null
  private gain: GainNode | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private endsAt = 0
  private volume = 1
  private generation = 0

  constructor(private readonly makeContext: () => AudioContext = () => new AudioContext()) {}

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.gain) this.gain.gain.value = this.volume
  }

  get playing(): boolean {
    return this.sources.size > 0
  }

  /**
   * Queue one chunk after whatever is already scheduled. Returns the delay in
   * ms until it starts.
   */
  enqueue(samples: Float32Array, sampleRate: number, hooks: PlayerHooks = {}): number {
    const ctx = this.context()
    if (ctx.state === 'suspended') void ctx.resume()
    const buffer = ctx.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain!)
    const startAt = Math.max(ctx.currentTime + LEAD_S, this.endsAt)
    const first = this.sources.size === 0
    this.endsAt = startAt + buffer.duration
    const generation = this.generation
    source.onended = () => {
      this.sources.delete(source)
      if (generation === this.generation && this.sources.size === 0) hooks.onIdle?.()
    }
    this.sources.add(source)
    source.start(startAt)
    if (first && hooks.onStart) {
      const delay = Math.max(0, (startAt - ctx.currentTime) * 1000)
      setTimeout(() => {
        if (generation === this.generation) hooks.onStart?.()
      }, delay)
    }
    return Math.max(0, (startAt - ctx.currentTime) * 1000)
  }

  /** Silence now and drop everything scheduled. */
  stop(): void {
    this.generation++
    for (const source of this.sources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        /* never started */
      }
      source.disconnect()
    }
    this.sources.clear()
    this.endsAt = 0
  }

  dispose(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
    this.gain = null
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = this.makeContext()
      this.gain = this.ctx.createGain()
      this.gain.gain.value = this.volume
      this.gain.connect(this.ctx.destination)
    }
    return this.ctx
  }
}

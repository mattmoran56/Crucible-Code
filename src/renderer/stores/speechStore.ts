// Audio out at runtime: the voice engine's status, who is speaking, and the
// glue from the Agent tab's frames to the SpeechController.
//
// GATED: nothing here loads or listens until Settings → Audio is switched on.
// The engine module (kokoro-js and its worker) is a dynamic import made only
// then; switching off tears it all down again.

import { create } from 'zustand'
import type { DownloadProgress, EngineInfo, TtsBackend, TtsEngine } from '../lib/audio/engine'
import { clearModelCache, summariseModelCache, type ModelCacheSummary } from '../lib/audio/modelCache'
import { AudioPlayer } from '../lib/audio/player'
import { SpeechController, type SpeechMetrics } from '../lib/audio/speechController'
import { addVisualAgentFrameListener, useVisualAgentStore } from './visualAgentStore'
import { useSessionStore } from './sessionStore'
import { audioSettings, useAudioSettingsStore } from './audioSettingsStore'

export const PREVIEW_LINE =
  "Hi, this is how Claude will sound in audio mode. I'll keep replies short and talk you through what I changed."

export type EngineStatus = 'off' | 'idle' | 'loading' | 'ready' | 'error'

interface SpeechState {
  status: EngineStatus
  backend: TtsBackend | null
  dtype: string | null
  loadMs: number | null
  progress: DownloadProgress | null
  error: string | null
  /** What is stored on disk, once checked. */
  model: ModelCacheSummary | null
  /** Whether this machine offers WebGPU (checked when audio is on). */
  webgpu: boolean | null
  speakingAgentId: string | null
  speakingKey: string | null
  metrics: SpeechMetrics | null
  /** Agents whose speech is paused from their header, by agent id. */
  muted: Record<string, true>

  /** Load the engine (downloading the model on first use). */
  ensureEngine: () => Promise<void>
  refreshModel: () => Promise<void>
  removeModel: () => Promise<void>
  preview: () => void
  replay: (agentId: string, key: string, text: string) => void
  stop: () => void
  setMuted: (agentId: string, muted: boolean) => void
  /** The person typed in an agent's composer. */
  typed: (agentId: string) => void
  /** The person sent an agent a message, or pressed Esc in its composer. */
  sent: (agentId: string) => void
}

let engine: TtsEngine | null = null
let engineReady: Promise<TtsEngine> | null = null
let controller: SpeechController | null = null
let player: AudioPlayer | null = null
let detach: (() => void)[] = []

const isAudioAgent = (agentId: string): boolean => useVisualAgentStore.getState().options[agentId]?.audioMode === true

export const useSpeechStore = create<SpeechState>((set, get) => {
  const loadEngine = (): Promise<TtsEngine> => {
    if (engineReady) return engineReady
    set({ status: 'loading', error: null, progress: null })
    engineReady = (async () => {
      const { KokoroEngine } = await import('../lib/audio/kokoroEngine')
      const created = new KokoroEngine()
      engine = created
      const info: EngineInfo = await created.init((progress) => set({ progress }))
      set({ status: 'ready', backend: info.backend, dtype: info.dtype, loadMs: info.loadMs, progress: null })
      void get().refreshModel()
      return created
    })()
    engineReady.catch((error: unknown) => {
      engineReady = null
      engine = null
      set({ status: 'error', error: error instanceof Error ? error.message : String(error), progress: null })
    })
    return engineReady
  }

  return {
    status: 'off',
    backend: null,
    dtype: null,
    loadMs: null,
    progress: null,
    error: null,
    model: null,
    webgpu: null,
    speakingAgentId: null,
    speakingKey: null,
    metrics: null,
    muted: {},

    ensureEngine: async () => {
      if (!audioSettings().enabled) return
      try {
        await loadEngine()
      } catch {
        /* status says so */
      }
    },

    refreshModel: async () => set({ model: await summariseModelCache() }),

    removeModel: async () => {
      get().stop()
      engine?.dispose()
      engine = null
      engineReady = null
      await clearModelCache()
      set({ status: audioSettings().enabled ? 'idle' : 'off', backend: null, dtype: null, loadMs: null })
      await get().refreshModel()
    },

    preview: () => controller?.preview(PREVIEW_LINE),
    replay: (agentId, key, text) => controller?.replay(agentId, key, text),
    stop: () => controller?.stop(),
    setMuted: (agentId, muted) => {
      controller?.setMuted(agentId, muted)
      set((s) => {
        const next = { ...s.muted }
        if (muted) next[agentId] = true
        else delete next[agentId]
        return { muted: next }
      })
    },
    typed: (agentId) => controller?.onTyping(agentId),
    sent: (agentId) => controller?.onSend(agentId),
  }
})

/** Switch audio out on: start listening and fetch/load the model. */
function attach(): void {
  if (controller) return
  player = new AudioPlayer()
  controller = new SpeechController({
    engine: async () => {
      // ensureEngine starts the load synchronously, so engineReady is set after it.
      if (!engineReady) void useSpeechStore.getState().ensureEngine()
      if (!engineReady) throw new Error('The voice engine is not available')
      return engineReady
    },
    player,
    settings: audioSettings,
    isAudioAgent,
    onChange: (snap) =>
      useSpeechStore.setState({ speakingAgentId: snap.speakingAgentId, speakingKey: snap.speakingKey, metrics: snap.metrics }),
    onError: (error) => useSpeechStore.setState({ error: error.message }),
  })
  for (const agentId of Object.keys(useSpeechStore.getState().muted)) controller.setMuted(agentId, true)

  detach.push(
    addVisualAgentFrameListener((agentId, frame) => {
      const c = controller
      if (!c) return
      if (frame.t === 'partial') c.onPartial(agentId, frame.threadId, frame.messageId, frame.text)
      else if (frame.t === 'event' && frame.event.kind === 'text' && frame.event.role === 'assistant') {
        c.onAssistantText(agentId, frame.event.threadId, frame.event.text, frame.event.replayed === true)
      } else if (frame.t === 'state' && (frame.state === 'idle' || frame.state === 'done' || frame.state === 'failed')) {
        c.onTurnEnd(agentId)
      }
    }),
  )
  controller.onActiveSession(useSessionStore.getState().activeSessionId)
  detach.push(
    useSessionStore.subscribe((s, prev) => {
      if (s.activeSessionId !== prev.activeSessionId) controller?.onActiveSession(s.activeSessionId)
    }),
  )
  detach.push(
    useAudioSettingsStore.subscribe((s, prev) => {
      if (s.volume !== prev.volume) player?.setVolume(s.volume)
    }),
  )

  useSpeechStore.setState({ status: 'idle', error: null })
  void detectWebGpu()
  void useSpeechStore.getState().refreshModel()
  void useSpeechStore.getState().ensureEngine()
}

/** Switch audio out off: stop, unload, stop listening. */
function teardown(): void {
  for (const off of detach) off()
  detach = []
  controller?.dispose()
  controller = null
  player?.dispose()
  player = null
  engine?.dispose()
  engine = null
  engineReady = null
  useSpeechStore.setState({
    status: 'off',
    backend: null,
    dtype: null,
    loadMs: null,
    progress: null,
    speakingAgentId: null,
    speakingKey: null,
  })
}

async function detectWebGpu(): Promise<void> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    useSpeechStore.setState({ webgpu: !!gpu && !!(await gpu.requestAdapter()) })
  } catch {
    useSpeechStore.setState({ webgpu: false })
  }
}

/**
 * Follow the master switch for the app's life. Called once from the app
 * shell; with audio off it does nothing but watch the switch.
 */
let started = false
export function startAudioOut(): () => void {
  if (started) return () => undefined
  started = true
  if (useAudioSettingsStore.getState().enabled) attach()
  const off = useAudioSettingsStore.subscribe((s, prev) => {
    if (s.enabled === prev.enabled) return
    if (s.enabled) attach()
    else teardown()
  })
  return () => {
    off()
    teardown()
    started = false
  }
}

/** Test-only. */
export const __speechInternals = { attach, teardown, controller: () => controller }

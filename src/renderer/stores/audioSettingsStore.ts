// Settings → Audio. Persisted like the other app settings (localStorage).
// Everything defaults off: with `enabled` false nothing about audio loads.

import { create } from 'zustand'
import type { CodeBlockSpeech } from '../lib/audio/speakable'
import { DEFAULT_VOICE, isKnownVoice } from '../lib/audio/voices'

const STORAGE_KEY = 'codecrucible-audio-settings'

export const SPEED_MIN = 0.75
export const SPEED_MAX = 1.5

export interface AudioSettings {
  /** Master switch. Off: no model download, no engine, no behaviour change. */
  enabled: boolean
  /** New Agent sessions start in audio mode. */
  defaultAudioMode: boolean
  voice: string
  /** 0.75–1.5. */
  speed: number
  /** 0–1. */
  volume: number
  codeBlocks: CodeBlockSpeech
  stopOnTyping: boolean
  stopOnSwitch: boolean
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: false,
  defaultAudioMode: false,
  voice: DEFAULT_VOICE,
  speed: 1,
  volume: 0.9,
  codeBlocks: 'announce',
  stopOnTyping: true,
  stopOnSwitch: false,
}

const clamp = (n: unknown, min: number, max: number, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback

/** Settings read back from storage, with anything missing or invalid at its default. */
export function sanitiseAudioSettings(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AudioSettings, unknown>>
  const d = DEFAULT_AUDIO_SETTINGS
  return {
    enabled: r.enabled === true,
    defaultAudioMode: r.defaultAudioMode === true,
    voice: isKnownVoice(r.voice) ? r.voice : d.voice,
    speed: clamp(r.speed, SPEED_MIN, SPEED_MAX, d.speed),
    volume: clamp(r.volume, 0, 1, d.volume),
    codeBlocks: r.codeBlocks === 'skip' || r.codeBlocks === 'announce' ? r.codeBlocks : d.codeBlocks,
    stopOnTyping: typeof r.stopOnTyping === 'boolean' ? r.stopOnTyping : d.stopOnTyping,
    stopOnSwitch: typeof r.stopOnSwitch === 'boolean' ? r.stopOnSwitch : d.stopOnSwitch,
  }
}

function load(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return sanitiseAudioSettings(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_AUDIO_SETTINGS }
}

function save(settings: AudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

interface AudioSettingsState extends AudioSettings {
  update: (patch: Partial<AudioSettings>) => void
  /** Tests and stories: back to defaults (or the given values) without persisting. */
  reset: (to?: Partial<AudioSettings>) => void
}

const pick = (s: AudioSettings): AudioSettings => ({
  enabled: s.enabled,
  defaultAudioMode: s.defaultAudioMode,
  voice: s.voice,
  speed: s.speed,
  volume: s.volume,
  codeBlocks: s.codeBlocks,
  stopOnTyping: s.stopOnTyping,
  stopOnSwitch: s.stopOnSwitch,
})

export const useAudioSettingsStore = create<AudioSettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    const next = sanitiseAudioSettings({ ...pick(get()), ...patch })
    set(next)
    save(next)
  },
  reset: (to = {}) => set(sanitiseAudioSettings({ ...DEFAULT_AUDIO_SETTINGS, ...to })),
}))

export const audioSettings = (): AudioSettings => pick(useAudioSettingsStore.getState())

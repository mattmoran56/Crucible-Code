import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { AudioSettings } from './AudioSettings'
import { useAudioSettingsStore, type AudioSettings as Settings } from '../../stores/audioSettingsStore'
import { useSpeechStore } from '../../stores/speechStore'

type SpeechSeed = Partial<ReturnType<typeof useSpeechStore.getState>>

/**
 * Seeds the settings and engine status directly. Nothing is loaded: the
 * stores are set as the running app would have them, without the engine.
 */
function Wrapper({ settings, speech }: { settings: Partial<Settings>; speech: SpeechSeed }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    useAudioSettingsStore.getState().reset(settings)
    // Keep the seeded model summary: the panel refreshes it from IndexedDB on mount.
    const model = speech.model ?? null
    useSpeechStore.setState({ ...speech, refreshModel: async () => useSpeechStore.setState({ model }) })
    setReady(true)
  }, [settings, speech])
  if (!ready) return null
  return (
    <div className="bg-bg" style={{ padding: 24, width: 720 }}>
      <AudioSettings />
    </div>
  )
}

const meta: Meta<typeof Wrapper> = {
  title: 'Settings/AudioSettings',
  component: Wrapper,
}
export default meta
type Story = StoryObj<typeof Wrapper>

const MB = 1024 * 1024

/** Off: the default. Nothing loads and nothing is downloaded. */
export const Off: Story = {
  args: { settings: { enabled: false }, speech: { status: 'off', model: { downloaded: false, bytes: 0, files: [] } } },
}

/** Just switched on: the model is downloading. */
export const Downloading: Story = {
  args: {
    settings: { enabled: true },
    speech: {
      status: 'loading',
      webgpu: true,
      progress: { loaded: 141 * MB, total: 326 * MB, file: 'onnx/model.onnx' },
      model: { downloaded: false, bytes: 0, files: [] },
    },
  },
}

/** Ready on WebGPU, with the last reply's timings. */
export const Ready: Story = {
  args: {
    settings: { enabled: true, defaultAudioMode: true, voice: 'bf_emma', speed: 1.1 },
    speech: {
      status: 'ready',
      backend: 'webgpu',
      dtype: 'fp32',
      webgpu: true,
      model: { downloaded: true, bytes: 326 * MB, files: ['onnx/model.onnx'] },
      metrics: { timeToFirstAudioMs: 310, realTimeFactor: 0.27, sentences: 6 },
    },
  },
}

/** No WebGPU: falls back to the quantised model on WASM. */
export const WasmFallback: Story = {
  args: {
    settings: { enabled: true },
    speech: {
      status: 'ready',
      backend: 'wasm',
      dtype: 'q8',
      webgpu: false,
      model: { downloaded: true, bytes: 92 * MB, files: ['onnx/model_quantized.onnx'] },
    },
  },
}

/** Switched off with the model still on disk: it can be removed. */
export const OffWithModel: Story = {
  args: {
    settings: { enabled: false },
    speech: { status: 'off', model: { downloaded: true, bytes: 92 * MB, files: ['onnx/model_quantized.onnx'] } },
  },
}

import React, { useEffect } from 'react'
import { SPEED_MAX, SPEED_MIN, useAudioSettingsStore } from '../../stores/audioSettingsStore'
import { useSpeechStore } from '../../stores/speechStore'
import { KOKORO_VOICES, voiceLabel } from '../../lib/audio/voices'
import { formatBytes } from '../../lib/audio/modelCache'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Button } from '../ui/Button'

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-border rounded-md" style={{ padding: '10px 14px' }}>
      <div className="min-w-0">
        <p className="text-xs font-medium text-text">{title}</p>
        <p className="text-[11px] text-text-muted">{hint}</p>
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  )
}

const onOff = [
  { value: 'off' as const, label: 'Off' },
  { value: 'on' as const, label: 'On' },
]

/**
 * Settings → Audio: audio out ("voice mode") for Agent sessions. Off by
 * default; switching it on downloads the Kokoro voice model (once) and the
 * rest of the panel opens up.
 */
export function AudioSettings() {
  const s = useAudioSettingsStore()
  const speech = useSpeechStore()

  // Show what is stored on disk whenever the panel is shown, on or off, so a
  // model left behind can still be removed.
  useEffect(() => {
    void useSpeechStore.getState().refreshModel()
  }, [s.enabled])

  const progress = speech.progress
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null
  const busy = speech.status === 'loading'
  const previewing = speech.speakingKey === 'preview'

  return (
    <div className="flex flex-col gap-3">
      <Row
        title="Audio out"
        hint={
          s.enabled
            ? 'Agent sessions in audio mode read their replies aloud with a local voice.'
            : 'Off: nothing loads and nothing is downloaded. On: downloads the Kokoro voice model once (about 90–330 MB).'
        }
      >
        <ToggleGroup options={onOff} value={s.enabled ? 'on' : 'off'} onChange={(v) => s.update({ enabled: v === 'on' })} />
      </Row>

      {s.enabled && (
        <>
          <div className="border border-border rounded-md flex flex-col gap-2" style={{ padding: '10px 14px' }} data-testid="audio-engine-status">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-text">Voice engine</p>
                <p className="text-[11px] text-text-muted">
                  {speech.status === 'ready'
                    ? `Kokoro-82M on ${speech.backend === 'webgpu' ? 'WebGPU' : 'WASM (CPU)'}, ${speech.dtype}. Ready.`
                    : speech.status === 'loading'
                      ? progress
                        ? `Downloading the voice model… ${pct !== null ? `${pct}% · ` : ''}${formatBytes(progress.loaded)}${progress.total ? ` of ${formatBytes(progress.total)}` : ''}`
                        : 'Loading the voice model…'
                      : speech.status === 'error'
                        ? `Could not load the voice: ${speech.error ?? 'unknown error'}`
                        : 'Not loaded yet.'}
                </p>
              </div>
              {speech.status === 'error' && (
                <Button size="sm" variant="ghost" className="border border-border" onClick={() => void speech.ensureEngine()}>
                  Retry
                </Button>
              )}
            </div>
            {busy && (
              <div
                role="progressbar"
                aria-label="Voice model download"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary"
              >
                <div
                  className={pct === null ? 'h-full w-1/3 animate-pulse bg-accent' : 'h-full bg-accent transition-[width]'}
                  style={pct === null ? undefined : { width: `${pct}%` }}
                />
              </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[11px]">
              <dt className="text-text-muted">Backend</dt>
              <dd className="text-text">
                {speech.webgpu === null ? 'Checking…' : speech.webgpu ? 'WebGPU available (fp32)' : 'WASM (q8): no WebGPU adapter'}
              </dd>
              <dt className="text-text-muted">Model</dt>
              <dd className="text-text">
                {speech.model?.downloaded ? `Downloaded · ${formatBytes(speech.model.bytes)}` : 'Not downloaded'}
              </dd>
              {speech.metrics && (
                <>
                  <dt className="text-text-muted">Last reply</dt>
                  <dd className="text-text tabular-nums" data-testid="audio-metrics">
                    {speech.metrics.timeToFirstAudioMs !== null ? `first audio ${speech.metrics.timeToFirstAudioMs} ms` : 'first audio —'}
                    {speech.metrics.realTimeFactor !== null ? ` · RTF ${speech.metrics.realTimeFactor.toFixed(2)}` : ''}
                    {` · ${speech.metrics.sentences} sentence${speech.metrics.sentences === 1 ? '' : 's'}`}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <Row title="New sessions start in audio mode" hint="The default for the Audio mode toggle when you create an Agent session.">
            <ToggleGroup
              options={onOff}
              value={s.defaultAudioMode ? 'on' : 'off'}
              onChange={(v) => s.update({ defaultAudioMode: v === 'on' })}
            />
          </Row>

          <Row title="Voice" hint="Kokoro's English voices. Preview speaks a sample line.">
            <select
              aria-label="Voice"
              value={s.voice}
              onChange={(e) => s.update({ voice: e.target.value })}
              className="bg-bg border border-border rounded-md text-xs text-text focus:outline-none focus:border-accent"
              style={{ padding: '4px 8px' }}
            >
              {(['en-US', 'en-GB'] as const).map((lang) => (
                <optgroup key={lang} label={lang === 'en-US' ? 'American English' : 'British English'}>
                  {KOKORO_VOICES.filter((v) => v.language === lang).map((v) => (
                    <option key={v.id} value={v.id}>
                      {voiceLabel(v)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              size="sm"
              variant="ghost"
              className="border border-border"
              onClick={() => (previewing ? speech.stop() : speech.preview())}
              disabled={speech.status === 'error'}
            >
              {previewing ? 'Stop' : 'Preview'}
            </Button>
          </Row>

          <Row title="Speed" hint={`${SPEED_MIN}× to ${SPEED_MAX}×.`}>
            <input
              type="range"
              aria-label="Speed"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={0.05}
              value={s.speed}
              onChange={(e) => s.update({ speed: Number(e.target.value) })}
              style={{ width: 140 }}
            />
            <span className="text-[11px] text-text tabular-nums" style={{ width: 40 }}>
              {s.speed.toFixed(2)}×
            </span>
          </Row>

          <Row title="Volume" hint="Applies straight away, mid-sentence included.">
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={s.volume}
              onChange={(e) => s.update({ volume: Number(e.target.value) })}
              style={{ width: 140 }}
            />
            <span className="text-[11px] text-text tabular-nums" style={{ width: 40 }}>
              {Math.round(s.volume * 100)}%
            </span>
          </Row>

          <Row title="Code blocks" hint="What the voice does when a reply contains a fenced code block.">
            <ToggleGroup
              options={[
                { value: 'skip' as const, label: 'Skip silently' },
                { value: 'announce' as const, label: 'Say “code block omitted”' },
              ]}
              value={s.codeBlocks}
              onChange={(v) => s.update({ codeBlocks: v })}
            />
          </Row>

          <Row title="Stop speaking when I type" hint="Typing in a session's composer silences that session's voice.">
            <ToggleGroup options={onOff} value={s.stopOnTyping ? 'on' : 'off'} onChange={(v) => s.update({ stopOnTyping: v === 'on' })} />
          </Row>

          <Row
            title="Stop speaking when I switch sessions"
            hint="Off: a reply keeps playing while you look elsewhere. Switching to a session that is replying always hands it the voice."
          >
            <ToggleGroup options={onOff} value={s.stopOnSwitch ? 'on' : 'off'} onChange={(v) => s.update({ stopOnSwitch: v === 'on' })} />
          </Row>
        </>
      )}

      {speech.model?.downloaded && (
        <Row
          title="Downloaded voice model"
          hint={`${formatBytes(speech.model.bytes)} stored by Crucible Code. Removing it frees the space; it downloads again next time audio out needs it.`}
        >
          <Button size="sm" variant="ghost" className="border border-danger/50 text-danger" onClick={() => void speech.removeModel()}>
            Remove model
          </Button>
        </Row>
      )}

      <p className="text-[11px] text-text-muted">
        Audio out is for Agent tab sessions only, and Esc in the composer stops the voice. Terminal sessions are never spoken.
      </p>
    </div>
  )
}

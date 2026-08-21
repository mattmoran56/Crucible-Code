import React, { useEffect, useState } from 'react'
import { useOverseerStore } from '../../stores/overseerStore'
import { OVERSEER_MODELS } from '../../../shared/types'

/**
 * Global Overseer settings. The API key lives here rather than in the panel —
 * it is a credential, not a per-conversation control. Model and heartbeat are
 * duplicated in the panel header because those are the ones you reach for
 * mid-conversation (and the model is the main cost lever).
 */
export function OverseerSettings() {
  const { settings, loaded, load, saveSettings } = useOverseerStore()
  const [keyDraft, setKeyDraft] = useState('')
  const [keyDirty, setKeyDirty] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    if (settings && !keyDirty) setKeyDraft(settings.apiKey ?? '')
  }, [settings, keyDirty])

  if (!settings) return null

  const field = 'w-full text-sm rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const fieldStyle = {
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    padding: '6px 8px',
  } as const

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 className="text-base font-medium" style={{ marginBottom: 4 }}>
        Overseer
      </h2>
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        A master agent that watches every session in every project. Talk to it in the Overseer
        panel on the right activity bar.
      </p>

      <label htmlFor="overseer-api-key" className="block text-sm" style={{ marginBottom: 4 }}>
        Anthropic API key
      </label>
      <div className="flex gap-2" style={{ marginBottom: 4 }}>
        <input
          id="overseer-api-key"
          type="password"
          value={keyDraft}
          placeholder="sk-ant-…"
          onChange={(e) => {
            setKeyDraft(e.target.value)
            setKeyDirty(true)
          }}
          className={field}
          style={fieldStyle}
        />
        <button
          onClick={() => {
            void saveSettings({ apiKey: keyDraft.trim() })
            setKeyDirty(false)
          }}
          disabled={!keyDirty}
          className="text-sm rounded disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{
            padding: '6px 12px',
            background: 'var(--color-accent)',
            color: 'var(--color-bg)',
          }}
        >
          Save
        </button>
      </div>
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        Billed to your Anthropic account, separate from your Claude Code subscription. Leave blank
        to fall back to the <code>ANTHROPIC_API_KEY</code> environment variable.
      </p>

      <label htmlFor="overseer-model" className="block text-sm" style={{ marginBottom: 4 }}>
        Model
      </label>
      <select
        id="overseer-model"
        value={settings.model}
        onChange={(e) => void saveSettings({ model: e.target.value })}
        className={field}
        style={{ ...fieldStyle, marginBottom: 4 }}
      >
        {OVERSEER_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} · {m.blurb}
          </option>
        ))}
      </select>
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        Haiku is the default and is plenty for status sweeps. Move up if you want it drafting
        replies to sessions.
      </p>

      <label htmlFor="overseer-cap" className="block text-sm" style={{ marginBottom: 4 }}>
        Daily cost cap (USD)
      </label>
      <input
        id="overseer-cap"
        type="number"
        min={0}
        step={0.5}
        value={settings.dailyCostCapUsd}
        onChange={(e) => void saveSettings({ dailyCostCapUsd: Number(e.target.value) })}
        className={field}
        style={{ ...fieldStyle, marginBottom: 4 }}
      />
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        Passes stop once the day&apos;s spend crosses this. A hard stop, not a warning.
      </p>

      <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={settings.heartbeatEnabled}
          onChange={(e) => void saveSettings({ heartbeatEnabled: e.target.checked })}
        />
        Heartbeat — check the fleet on a timer
      </label>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <input
          aria-label="Heartbeat interval in seconds"
          type="number"
          min={30}
          step={30}
          value={settings.heartbeatSeconds}
          onChange={(e) => void saveSettings({ heartbeatSeconds: Number(e.target.value) })}
          className="text-sm rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ ...fieldStyle, width: 100 }}
        />
        <span className="text-sm text-text-muted">seconds between checks (minimum 30)</span>
      </div>
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        A tick that finds the fleet unchanged since the last one costs nothing — it never reaches
        the model. Only a change in status or signals spends anything.
      </p>

      <label className="flex items-center gap-2 text-sm" style={{ marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={settings.allowWrites}
          onChange={(e) => void saveSettings({ allowWrites: e.target.checked })}
        />
        Allow writes — type into sessions and start new ones
      </label>
      <p className="text-xs text-text-muted" style={{ marginBottom: 16 }}>
        Off means read-only: it can look and report, but not act. Even with writes on, it refuses
        to answer a tool-permission prompt — those stay yours.
      </p>

      <label htmlFor="overseer-max-rounds" className="block text-sm" style={{ marginBottom: 4 }}>
        Max tool rounds per turn
      </label>
      <input
        id="overseer-max-rounds"
        type="number"
        min={1}
        max={40}
        value={settings.maxIterations}
        onChange={(e) => void saveSettings({ maxIterations: Number(e.target.value) })}
        className={field}
        style={{ ...fieldStyle, marginBottom: 4 }}
      />
      <p className="text-xs text-text-muted">
        How many times it may call a tool before the loop bails out. Stops a confused turn from
        looping up a bill.
      </p>
    </div>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import { useOverseerStore } from '../../stores/overseerStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { OVERSEER_MODELS, type OverseerMessage } from '../../../shared/types'

marked.setOptions({ breaks: true })

const SUGGESTIONS = [
  'Give me a table of all sessions, roughly where each is up to, and whether it needs input.',
  'What needs my attention right now?',
  'Is anything stuck?',
]

function ToolLine({ message }: { message: OverseerMessage }) {
  return (
    <div
      className="flex items-center gap-2 text-xs text-text-muted"
      style={{ padding: '2px 12px' }}
    >
      <span
        className="rounded-full flex-shrink-0"
        style={{
          width: 5,
          height: 5,
          background: message.toolOk === false ? 'var(--color-danger)' : 'var(--color-success)',
        }}
      />
      <span className="truncate">{message.content}</span>
    </div>
  )
}

function Bubble({ message }: { message: OverseerMessage }) {
  const html = useMemo(() => marked.parse(message.content) as string, [message.content])

  if (message.role === 'tool') return <ToolLine message={message} />

  if (message.role === 'system') {
    return (
      <div className="text-xs text-text-muted italic" style={{ padding: '4px 12px' }}>
        {message.content}
      </div>
    )
  }

  const isUser = message.role === 'user'
  return (
    <div style={{ padding: '6px 12px', minWidth: 0 }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 3 }}>
        <span className="text-xs font-medium text-text-muted">
          {isUser ? 'You' : 'Overseer'}
        </span>
        {message.fromHeartbeat && (
          <span
            className="text-xs rounded"
            style={{
              padding: '0 4px',
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text-muted)',
            }}
          >
            heartbeat
          </span>
        )}
        {message.needsAttention && (
          <span className="text-xs" style={{ color: 'var(--color-warning)' }}>
            needs you
          </span>
        )}
      </div>
      <div
        className="text-sm markdown-body overseer-markdown"
        style={{
          background: isUser ? 'var(--color-bg-tertiary)' : 'transparent',
          borderRadius: 6,
          padding: isUser ? '6px 8px' : 0,
          color: 'var(--color-text)',
          overflowWrap: 'anywhere',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export function OverseerPanel() {
  const {
    state,
    settings,
    loaded,
    load,
    send,
    cancel,
    clear,
    heartbeatNow,
    saveSettings,
    markRead,
  } = useOverseerStore()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const { currentProjectId, loadSessions } = useSessionStore()
  const { projects } = useProjectStore()

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Opening the panel is reading it — drop the activity-bar dot.
  useEffect(() => {
    void markRead()
  }, [markRead, state.messages.length])

  // A session the Overseer started only exists in main until the renderer
  // reloads its list — otherwise it would not appear in the sidebar.
  useEffect(() => {
    return window.api.overseer.onSessionsChanged((projectId) => {
      const project = projects.find((p) => p.id === projectId)
      if (project && projectId === currentProjectId) {
        void loadSessions(projectId)
      }
    })
  }, [projects, currentProjectId, loadSessions])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [state.messages.length])

  const submit = () => {
    if (!draft.trim() || state.running) return
    void send(draft)
    setDraft('')
  }

  const capReached = !!settings && state.spendTodayUsd >= settings.dailyCostCapUsd

  return (
    <div
      className="h-full flex flex-col min-w-0 overflow-hidden"
      style={{ background: 'var(--color-bg-secondary)' }}
    >
      {settings && (
        <div
          className="flex items-center gap-2 border-b border-border flex-shrink-0 flex-wrap"
          style={{ padding: '6px 12px' }}
        >
          <select
            aria-label="Overseer model"
            value={settings.model}
            onChange={(e) => void saveSettings({ model: e.target.value })}
            className="text-xs rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              padding: '2px 4px',
            }}
          >
            {OVERSEER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <label className="text-xs text-text-muted flex items-center gap-1">
            <input
              type="checkbox"
              checked={settings.heartbeatEnabled}
              onChange={(e) => void saveSettings({ heartbeatEnabled: e.target.checked })}
            />
            Heartbeat
          </label>

          <input
            aria-label="Heartbeat interval in seconds"
            type="number"
            min={30}
            step={30}
            value={settings.heartbeatSeconds}
            onChange={(e) => void saveSettings({ heartbeatSeconds: Number(e.target.value) })}
            className="text-xs rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{
              width: 52,
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              padding: '2px 4px',
            }}
          />
          <span className="text-xs text-text-muted">s</span>

          <label
            className="text-xs text-text-muted flex items-center gap-1"
            title="Let the Overseer type into sessions and start new ones"
          >
            <input
              type="checkbox"
              checked={settings.allowWrites}
              onChange={(e) => void saveSettings({ allowWrites: e.target.checked })}
            />
            Writes
          </label>

          <button
            onClick={() => void heartbeatNow()}
            disabled={state.running}
            className="text-xs text-text-muted hover:text-text disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Check now
          </button>

          <span className="text-xs text-text-muted ml-auto" title="Spend today">
            ${state.spendTodayUsd.toFixed(3)}
          </span>
          <button
            onClick={() => void clear()}
            className="text-xs text-text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            aria-label="Clear conversation"
          >
            Clear
          </button>
        </div>
      )}

      {!settings?.apiKey && (
        <div className="text-xs" style={{ padding: '6px 12px', color: 'var(--color-warning)' }}>
          No API key set — add one in Settings → Overseer (or export ANTHROPIC_API_KEY).
        </div>
      )}
      {capReached && (
        <div className="text-xs" style={{ padding: '6px 12px', color: 'var(--color-warning)' }}>
          Daily cost cap reached. Raise it in Settings → Overseer to continue.
        </div>
      )}
      {state.lastError && (
        <div className="text-xs" style={{ padding: '6px 12px', color: 'var(--color-danger)' }}>
          {state.lastError}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto" style={{ paddingBottom: 8 }}>
        {state.messages.length === 0 && (
          <div style={{ padding: 12 }}>
            <p className="text-xs text-text-muted" style={{ marginBottom: 8 }}>
              Ask about your sessions across every project.
            </p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void send(s)}
                className="text-xs text-left w-full rounded hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                style={{
                  padding: '6px 8px',
                  marginBottom: 4,
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {state.messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        {state.running && (
          <div className="text-xs text-text-muted" style={{ padding: '4px 12px' }}>
            Working…{' '}
            <button
              onClick={() => void cancel()}
              className="underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              stop
            </button>
          </div>
        )}
      </div>

      <div className="border-t border-border flex-shrink-0" style={{ padding: 8 }}>
        <textarea
          aria-label="Message the Overseer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="Ask about your sessions…"
          className="w-full text-sm rounded resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
            padding: '6px 8px',
          }}
        />
      </div>
    </div>
  )
}

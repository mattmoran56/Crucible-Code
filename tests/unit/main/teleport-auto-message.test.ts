// The automated first message a teleport types into the REPL (so Claude saves
// the conversation locally): how the Agent view shows it once the history is
// rebuilt from Claude's transcript, and the checklist step it reports.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
  shellQuote: (a: string) => a,
}))

import {
  claudeTranscriptToEntries,
  teleportAutoReplied,
} from '../../../src/main/services/visual-agent/claude-transcript'
import { normalise, type NormaliseContext } from '../../../src/main/services/visual-agent/normalise'
import { TELEPORT_AUTO_LABEL, TELEPORT_AUTO_MESSAGE } from '../../../src/shared/visual-agent'
import { teleportStepStates } from '../../../src/renderer/components/cloud/TeleportProgress'

const ctx = (): NormaliseContext => {
  let n = 0
  return { seq: 0, fallbackId: () => `fb-${n++}`, now: () => '2026-10-22T00:00:00.000Z', lastSession: null }
}

const user = (text: string, uuid: string) =>
  JSON.stringify({ type: 'user', uuid, timestamp: 't', message: { role: 'user', content: text } })
const assistant = (text: string, uuid: string) =>
  JSON.stringify({ type: 'assistant', uuid, timestamp: 't', message: { role: 'assistant', content: [{ type: 'text', text }] } })

const FILE = [
  user('Fix the login bug', 'u1'),
  assistant('Done — the login bug is fixed.', 'a1'),
  user(TELEPORT_AUTO_MESSAGE, 'u2'),
  assistant('Ready.', 'a2'),
  user('Now add a test', 'u3'),
  assistant('Added.', 'a3'),
].join('\n')

describe('the automated teleport message in the Agent view history', () => {
  it('folds the message into a "Teleported from the cloud" note and drops Claude\'s reply to it', () => {
    const events = claudeTranscriptToEntries(FILE).flatMap((e) => normalise(JSON.parse(e.line), ctx()))
    const shown = events.map((e) => (e.kind === 'note' ? `note:${e.label}` : e.kind === 'text' ? `${e.role}:${e.text}` : e.kind))
    expect(shown).toEqual([
      'user:Fix the login bug',
      'assistant:Done — the login bug is fixed.',
      `note:${TELEPORT_AUTO_LABEL}`,
      'user:Now add a test',
      'assistant:Added.',
    ])
  })

  it('matches only the exact text — a person writing something similar is shown as typed', () => {
    const events = normalise(JSON.parse(user(`${TELEPORT_AUTO_MESSAGE} Also fix X.`, 'u9')), ctx())
    expect(events[0]).toMatchObject({ kind: 'text', role: 'user' })
  })

  it('knows when Claude has answered the automated message', () => {
    expect(teleportAutoReplied(user(TELEPORT_AUTO_MESSAGE, 'u2'))).toBe(false)
    expect(teleportAutoReplied([user(TELEPORT_AUTO_MESSAGE, 'u2'), assistant('Ready.', 'a2')].join('\n'))).toBe(true)
    // A reply before the automated message does not count.
    expect(teleportAutoReplied([assistant('Earlier', 'a0'), user(TELEPORT_AUTO_MESSAGE, 'u2')].join('\n'))).toBe(false)
  })
})

describe('the teleport checklist', () => {
  it('shows "Saving the conversation locally" as active from the REPL being up until the run finishes', () => {
    const base = {
      sessionId: 's1',
      terminalId: 't',
      startedAt: 'x',
      steps: ['Validating session', 'Fetching session logs', 'Getting branch info', 'Checking out branch', 'Session resumed'],
    }
    const before = teleportStepStates({ ...base, status: 'running' })
    expect(before.find((s) => s.label === 'Saving the conversation locally')?.state).toBe('active')
    const after = teleportStepStates({ ...base, status: 'running', steps: [...base.steps, 'Saving the conversation locally'] })
    expect(after.find((s) => s.label === 'Saving the conversation locally')?.state).toBe('active')
    expect(after.at(-1)).toMatchObject({ label: 'Opening it in the Agent view', state: 'todo' })
    const finishing = teleportStepStates({ ...base, status: 'finishing', steps: [...base.steps, 'Saving the conversation locally'] })
    expect(finishing.find((s) => s.label === 'Saving the conversation locally')?.state).toBe('done')
    expect(finishing.at(-1)).toMatchObject({ state: 'active' })
  })
})

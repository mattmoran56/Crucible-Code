import { describe, it, expect } from 'vitest'
import {
  canTypeInto,
  costForUsage,
  deriveSignals,
  detectPromptState,
  heartbeatWorthRunning,
  nextSessionStatus,
  rollupStatus,
  snapshotDigest,
  stripAnsi,
} from '@shared/overseer'
import type { OverseerSessionSnapshot } from '@shared/types'

const ESC = '\u001b'

function snapshot(
  over: Partial<OverseerSessionSnapshot> & { sessionId: string }
): OverseerSessionSnapshot {
  return {
    name: 'a-session',
    projectId: 'p1',
    projectName: 'Project',
    branchName: 'session/a',
    status: 'running',
    signals: [],
    hasAgentTerminal: true,
    ...over,
  }
}

describe('nextSessionStatus', () => {
  it('moves to running on a prompt', () => {
    expect(nextSessionStatus(undefined, 'prompt')).toBe('running')
  })

  it('does not churn when already running', () => {
    expect(nextSessionStatus('running', 'prompt')).toBeNull()
  })

  it('always escalates to attention on a notification', () => {
    expect(nextSessionStatus('running', 'notification')).toBe('attention')
    expect(nextSessionStatus('completed', 'notification')).toBe('attention')
  })

  it('completes on stop, including out of attention', () => {
    expect(nextSessionStatus('running', 'stop')).toBe('completed')
    // Deliberate divergence from the renderer store, which defers this to
    // preserve the badge. Main has no badge to preserve.
    expect(nextSessionStatus('attention', 'stop')).toBe('completed')
  })
})

describe('rollupStatus', () => {
  it('prefers attention over everything', () => {
    expect(rollupStatus(['running', 'completed', 'attention'])).toBe('attention')
  })

  it('prefers completed over running', () => {
    expect(rollupStatus(['running', 'completed'])).toBe('completed')
  })

  it('is undefined for no tabs', () => {
    expect(rollupStatus([])).toBeUndefined()
  })
})

describe('stripAnsi', () => {
  it('removes colour codes but keeps the text and newlines', () => {
    const input = `${ESC}[31mred${ESC}[0m\nplain`
    expect(stripAnsi(input)).toBe('red\nplain')
  })

  it('removes OSC title sequences', () => {
    expect(stripAnsi(`${ESC}]0;a title\u0007body`)).toBe('body')
  })
})

describe('detectPromptState', () => {
  it('spots a tool-permission prompt', () => {
    const screen = [
      'Claude wants to run npm test',
      '',
      'Do you want to proceed?',
      '1. Yes',
      "2. Yes, and don't ask again",
      '3. No, and tell Claude what to do differently',
    ].join('\n')
    expect(detectPromptState(screen)).toBe('permission-prompt')
  })

  it('spots a permission prompt even through ANSI decoration', () => {
    const screen = `${ESC}[1mClaude wants to run${ESC}[0m rm -rf build\n${ESC}[32m1. Yes${ESC}[0m\n2. No`
    expect(detectPromptState(screen)).toBe('permission-prompt')
  })

  it('reads an idle composer as safe to type into', () => {
    expect(detectPromptState('some earlier output\n> ')).toBe('input-idle')
  })

  it('reads a spinner as working', () => {
    expect(detectPromptState('Exploring the codebase… (esc to interrupt)')).toBe('working')
  })

  it('reads a trailing question as a question', () => {
    expect(
      detectPromptState('I could use Redis or in-memory. Which would you prefer?')
    ).toBe('question')
  })

  it('fails closed on output it cannot classify', () => {
    expect(detectPromptState('gibberish with no structure at all')).toBe('unknown')
  })

  it('treats a bare numbered menu as unsafe', () => {
    expect(detectPromptState('Pick one:\n> 1. Alpha\n2. Beta')).toBe('unknown')
  })
})

describe('canTypeInto — the write gate', () => {
  it('permits only idle and question states', () => {
    expect(canTypeInto('input-idle')).toBe(true)
    expect(canTypeInto('question')).toBe(true)
  })

  it('refuses a permission prompt', () => {
    expect(canTypeInto('permission-prompt')).toBe(false)
  })

  it('refuses working and unknown', () => {
    expect(canTypeInto('working')).toBe(false)
    expect(canTypeInto('unknown')).toBe(false)
  })
})

describe('deriveSignals', () => {
  it('reports a missing terminal and stops there', () => {
    expect(deriveSignals({ hasAgentTerminal: false, status: 'attention' })).toEqual([
      'no-agent-terminal',
    ])
  })

  it('separates a permission block from a question', () => {
    expect(
      deriveSignals({
        hasAgentTerminal: true,
        status: 'attention',
        promptState: 'permission-prompt',
      })
    ).toEqual(['waiting-permission'])

    expect(
      deriveSignals({ hasAgentTerminal: true, status: 'attention', promptState: 'question' })
    ).toEqual(['waiting-question'])
  })

  it('flags a long silence only while running', () => {
    const twentyMinutes = 20 * 60 * 1000
    expect(
      deriveSignals({
        hasAgentTerminal: true,
        status: 'running',
        msSinceOutput: twentyMinutes,
      })
    ).toContain('no-output-15m')

    expect(
      deriveSignals({
        hasAgentTerminal: true,
        status: 'completed',
        msSinceOutput: twentyMinutes,
      })
    ).not.toContain('no-output-15m')
  })
})

describe('heartbeat change detection', () => {
  it('runs when the fleet has never been seen', () => {
    const fleet = [snapshot({ sessionId: 's1' })]
    expect(heartbeatWorthRunning(fleet, undefined)).toBe(true)
  })

  it('skips an unchanged fleet — this is what keeps a quiet fleet free', () => {
    const fleet = [snapshot({ sessionId: 's1' })]
    expect(heartbeatWorthRunning(fleet, snapshotDigest(fleet))).toBe(false)
  })

  it('runs when a session changes status', () => {
    const before = [snapshot({ sessionId: 's1', status: 'running' })]
    const after = [snapshot({ sessionId: 's1', status: 'attention' })]
    expect(heartbeatWorthRunning(after, snapshotDigest(before))).toBe(true)
  })

  it('runs when a signal appears without a status change', () => {
    const before = [snapshot({ sessionId: 's1', status: 'running' })]
    const after = [snapshot({ sessionId: 's1', status: 'running', signals: ['no-output-15m'] })]
    expect(heartbeatWorthRunning(after, snapshotDigest(before))).toBe(true)
  })

  it('ignores ordering so a reshuffled list is not a change', () => {
    const a = snapshot({ sessionId: 's1' })
    const b = snapshot({ sessionId: 's2' })
    expect(snapshotDigest([a, b])).toBe(snapshotDigest([b, a]))
  })
})

describe('costForUsage', () => {
  it('prices Haiku at its published rate', () => {
    // 1M input + 1M output = $1 + $5
    expect(costForUsage('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(6)
  })

  it('prices Opus higher than Haiku for the same tokens', () => {
    const haiku = costForUsage('claude-haiku-4-5', 10_000, 1_000)
    const opus = costForUsage('claude-opus-5', 10_000, 1_000)
    expect(opus).toBeGreaterThan(haiku)
  })

  it('never reports an unknown model as free', () => {
    expect(costForUsage('some-future-model', 100_000, 10_000)).toBeGreaterThan(0)
  })
})

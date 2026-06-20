import { describe, expect, it, vi } from 'vitest'

// node-pty has no linux-x64 prebuilds, and the foreman service imports
// terminal.service for the foreman PTY spawn — stub the chain on CI.
vi.mock('node-pty', () => ({ spawn: () => ({ onData: () => {}, onExit: () => {}, write: () => {}, kill: () => {}, resize: () => {} }) }))
vi.mock('../../../src/main/services/terminal.service', () => ({
  spawnTerminal: () => 'mock-term-1',
  killTerminal: () => {},
  writeTerminal: () => {},
  getTerminalBuffer: () => '',
  listTerminalsForSession: () => [],
}))

vi.mock('electron-store', () => ({ default: class { constructor(){} get(){return {}} set(){} delete(){} } }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp/foundry-foreman-test' }))
vi.mock('../../../src/main/services/notion-poller.service', () => ({
  loadConfig: () => null,
  addPickedUp: vi.fn(),
}))
vi.mock('../../../src/main/services/foundry.service', () => ({
  countActivePipelines: () => 0,
  flushState: vi.fn(),
  getRuntime: () => undefined,
  notionAccessFor: () => null,
  registerForemanRunner: vi.fn(),
  startPipeline: vi.fn(),
  tryAppendTicketMarkdown: vi.fn(),
}))

import { buildPassPrompt, validateDecision } from '../../../src/main/services/foundry-foreman.service'

function ctx(overrides: any = {}): any {
  return {
    foundry: { id: 'f', name: 'F' },
    freeSlots: 2,
    completionTransition: { property: 'Status', toValue: 'Testing' },
    completedStatuses: ['Done'],
    runningPipelines: [],
    tasks: [
      { pageId: 'p1', title: 'a', url: '', status: 'Ready', body: '' },
      { pageId: 'p2', title: 'b', url: '', status: 'Ready', body: '' },
      { pageId: 'p3', title: 'c', url: '', status: 'Ready', body: '' },
    ],
    ...overrides,
  }
}

describe('validateDecision', () => {
  it('keeps valid start entries up to freeSlots', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok' }, { pageId: 'p2', reason: 'ok' }, { pageId: 'p3', reason: 'overflow' }], summary: 's' },
      ctx({ freeSlots: 2 }),
      {}
    )
    expect(res.applied.start).toHaveLength(2)
    expect(res.warnings.some((w) => w.includes('freeSlots'))).toBe(true)
  })

  it('drops start entries referencing unknown page ids', () => {
    const res = validateDecision(
      { start: [{ pageId: 'nope', reason: '' }], summary: 's' },
      ctx(),
      {}
    )
    expect(res.applied.start).toHaveLength(0)
    expect(res.warnings.some((w) => w.includes('not in task set'))).toBe(true)
  })

  it('drops start entries for pages already running', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: '' }], summary: 's' },
      ctx({ runningPipelines: [{ pageId: 'p1', phase: 'implementing' }] }),
      {}
    )
    expect(res.applied.start).toHaveLength(0)
    expect(res.warnings.some((w) => w.includes('already running'))).toBe(true)
  })

  it('deduplicates ticketNotes by content hash', () => {
    const documented: Record<string, string> = {}
    const decision = {
      ticketNotes: [{ pageId: 'p1', comment: '**Foundry plan** — A' }],
      start: [],
      summary: '',
    }
    const first = validateDecision(decision, ctx(), documented)
    expect(first.applied.ticketNotes).toHaveLength(1)
    // Second call with same content should drop the note.
    const second = validateDecision(decision, ctx(), documented)
    expect(second.applied.ticketNotes).toHaveLength(0)
    expect(second.warnings.some((w) => w.includes('duplicate content'))).toBe(true)
  })

  it('throws on a non-object decision', () => {
    expect(() => validateDecision('not an object', ctx(), {})).toThrow()
  })

  it('accepts an empty start array as a valid zero-start outcome', () => {
    const res = validateDecision({ start: [], summary: 'nothing eligible' }, ctx(), {})
    expect(res.applied.start).toHaveLength(0)
    expect(res.applied.summary).toBe('nothing eligible')
  })

  it('first-pass prompt omits the continuation paragraph', () => {
    const prompt = buildPassPrompt('/ctx.json', '/dec.json', ctx(), {
      passIndex: 1,
      isFirstPass: true,
    })
    expect(prompt).not.toContain('This is pass #')
    expect(prompt).toContain('Foundry Foreman')
  })

  it('subsequent-pass prompt includes the memory continuation', () => {
    const prompt = buildPassPrompt('/ctx.json', '/dec.json', ctx(), {
      passIndex: 4,
      isFirstPass: false,
    })
    expect(prompt).toContain('This is pass #4')
    expect(prompt).toContain('memory of previous passes')
  })

  it('filters dependsOn to known page ids', () => {
    const res = validateDecision(
      {
        ticketNotes: [{ pageId: 'p1', comment: 'plan', dependsOn: ['p2', 'unknown'] }],
        start: [],
        summary: '',
      },
      ctx(),
      {}
    )
    expect(res.applied.ticketNotes?.[0].dependsOn).toEqual(['p2'])
  })

  it('honors optimisticDependsOn when optimisticContinue is on (filtering unknown + self)', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok', optimisticDependsOn: ['p2', 'p1', 'unknown', 'p2'] }], summary: 's' },
      ctx({ optimisticContinue: true, optimisticStatuses: ['In review'] }),
      {}
    )
    // Drops self-reference (p1), unknown ids, and dedupes — leaving just p2.
    expect(res.applied.start[0].optimisticDependsOn).toEqual(['p2'])
  })

  it('ignores optimisticDependsOn when optimisticContinue is off', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok', optimisticDependsOn: ['p2'] }], summary: 's' },
      ctx({ optimisticContinue: false }),
      {}
    )
    expect(res.applied.start[0].optimisticDependsOn).toBeUndefined()
  })

  it('leaves optimisticDependsOn undefined when every listed dep is unknown', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok', optimisticDependsOn: ['nope', 'gone'] }], summary: 's' },
      ctx({ optimisticContinue: true }),
      {}
    )
    // Not an empty array — undefined, so the FSM treats it as "no deps to merge".
    expect(res.applied.start[0].optimisticDependsOn).toBeUndefined()
  })

  it('leaves optimisticDependsOn undefined when the field is not an array', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok', optimisticDependsOn: 'p2' }], summary: 's' },
      ctx({ optimisticContinue: true }),
      {}
    )
    expect(res.applied.start[0].optimisticDependsOn).toBeUndefined()
  })

  it('preserves multiple valid optimistic deps in order', () => {
    const res = validateDecision(
      { start: [{ pageId: 'p1', reason: 'ok', optimisticDependsOn: ['p3', 'p2'] }], summary: 's' },
      ctx({ optimisticContinue: true }),
      {}
    )
    expect(res.applied.start[0].optimisticDependsOn).toEqual(['p3', 'p2'])
  })

  it('does not leak optimistic deps from a start entry dropped by the freeSlots cap', () => {
    const res = validateDecision(
      {
        start: [
          { pageId: 'p1', reason: 'ok' },
          { pageId: 'p2', reason: 'ok' },
          { pageId: 'p3', reason: 'overflow', optimisticDependsOn: ['p1'] },
        ],
        summary: 's',
      },
      ctx({ optimisticContinue: true, freeSlots: 2 }),
      {}
    )
    expect(res.applied.start).toHaveLength(2)
    expect(res.applied.start.some((s) => s.pageId === 'p3')).toBe(false)
  })
})

describe('buildPassPrompt — optimistic continue', () => {
  it('includes the optimistic section + field when the toggle is on', () => {
    const prompt = buildPassPrompt('/ctx.json', '/dec.json', ctx({
      optimisticContinue: true,
      optimisticStatuses: ['In review'],
    }), { passIndex: 1, isFirstPass: true })
    expect(prompt).toContain('Optimistic continue (ENABLED)')
    expect(prompt).toContain('optimisticDependsOn')
    expect(prompt).toContain('In review')
  })

  it('omits the optimistic section when the toggle is off', () => {
    const prompt = buildPassPrompt('/ctx.json', '/dec.json', ctx({
      optimisticContinue: false,
      optimisticStatuses: [],
    }), { passIndex: 1, isFirstPass: true })
    expect(prompt).not.toContain('Optimistic continue (ENABLED)')
    expect(prompt).not.toContain('optimisticDependsOn')
    expect(prompt).not.toContain('optimisticStatuses')
  })

  it('surfaces custom optimistic statuses in the prompt body', () => {
    const prompt = buildPassPrompt('/ctx.json', '/dec.json', ctx({
      optimisticContinue: true,
      optimisticStatuses: ['In review', 'QA'],
    }), { passIndex: 2, isFirstPass: false })
    expect(prompt).toContain('"QA"')
    // Both the input description and the dedicated section reference the list.
    expect(prompt).toContain('optimisticStatuses')
    expect(prompt).toContain('Optimistic continue (ENABLED)')
    // And it still carries the cross-pass memory continuation.
    expect(prompt).toContain('This is pass #2')
  })
})

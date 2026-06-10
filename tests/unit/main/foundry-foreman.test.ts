import { describe, expect, it, vi } from 'vitest'

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

import { validateDecision } from '../../../src/main/services/foundry-foreman.service'

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
})

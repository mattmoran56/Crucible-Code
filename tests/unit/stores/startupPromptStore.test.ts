import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  promptNeedsInput,
  resolveStartupCommand,
  useStartupPromptStore,
} from '../../../src/renderer/stores/startupPromptStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const list = vi.fn()
const save = vi.fn()

beforeEach(() => {
  list.mockReset()
  save.mockReset()
  ;(window as any).api = {
    startupPrompt: { list, save },
  }
  useStartupPromptStore.setState({ byProject: {}, loadingProjects: new Set() })
  useToastStore.setState({ toasts: [] })
})

const P = (id: string, order: number, label = id) =>
  ({ id, label, command: 'echo {{input}}', order, requiresInput: false } as any)

describe('promptNeedsInput', () => {
  it('detects {{input}} placeholders', () => {
    expect(promptNeedsInput('echo hi')).toBe(false)
    expect(promptNeedsInput('echo {{input}}')).toBe(true)
    expect(promptNeedsInput('foo {{input}} bar {{input}}')).toBe(true)
  })
})

describe('resolveStartupCommand', () => {
  it('substitutes every {{input}} placeholder', () => {
    expect(resolveStartupCommand('echo {{input}}', 'hi')).toBe('echo hi')
    expect(resolveStartupCommand('a {{input}} b {{input}}', 'X')).toBe('a X b X')
  })

  it('leaves the command unchanged if there is no placeholder', () => {
    expect(resolveStartupCommand('echo hi', 'X')).toBe('echo hi')
  })
})

describe('startupPromptStore.load', () => {
  it('sorts by order on load', async () => {
    list.mockResolvedValue([P('b', 2), P('a', 1), P('c', 3)])
    await useStartupPromptStore.getState().load('p1')
    expect(useStartupPromptStore.getState().getForProject('p1').map((p: any) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('skips reentrant loads while one is already in flight', async () => {
    let resolve: (v: any) => void = () => {}
    list.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const first = useStartupPromptStore.getState().load('p1')
    await useStartupPromptStore.getState().load('p1') // returns immediately because in-flight
    expect(list).toHaveBeenCalledTimes(1)
    resolve([])
    await first
  })

  it('emits a toast when the api throws', async () => {
    list.mockRejectedValue(new Error('disk full'))
    await useStartupPromptStore.getState().load('p1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })
})

describe('startupPromptStore.add / update / remove / reorder', () => {
  it('add appends and persists in sorted order', async () => {
    save.mockResolvedValue(undefined)
    await useStartupPromptStore.getState().add('p1', P('a', 0))
    await useStartupPromptStore.getState().add('p1', P('b', 1))
    expect(useStartupPromptStore.getState().getForProject('p1').map((p: any) => p.id)).toEqual(['a', 'b'])
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('update replaces by id', async () => {
    save.mockResolvedValue(undefined)
    useStartupPromptStore.setState({ byProject: { p1: [P('a', 0), P('b', 1)] } })
    await useStartupPromptStore.getState().update('p1', P('b', 1, 'new label'))
    const list = useStartupPromptStore.getState().getForProject('p1') as any[]
    expect(list.find((p) => p.id === 'b').label).toBe('new label')
  })

  it('remove drops the entry', async () => {
    save.mockResolvedValue(undefined)
    useStartupPromptStore.setState({ byProject: { p1: [P('a', 0), P('b', 1)] } })
    await useStartupPromptStore.getState().remove('p1', 'a')
    expect(useStartupPromptStore.getState().getForProject('p1').map((p: any) => p.id)).toEqual(['b'])
  })

  it('reorder rewrites order indices', async () => {
    save.mockResolvedValue(undefined)
    useStartupPromptStore.setState({ byProject: { p1: [P('a', 0), P('b', 1), P('c', 2)] } })
    await useStartupPromptStore.getState().reorder('p1', ['c', 'a', 'b'])
    const ids = useStartupPromptStore.getState().getForProject('p1').map((p: any) => p.id)
    expect(ids).toEqual(['c', 'a', 'b'])
  })
})

describe('startupPromptStore.getForProject', () => {
  it('returns an empty array for unknown projects', () => {
    expect(useStartupPromptStore.getState().getForProject('nope')).toEqual([])
  })
})

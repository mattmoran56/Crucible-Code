import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useButtonStore } from '../../../src/renderer/stores/buttonStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const buttonApi = {
  list: vi.fn(),
  save: vi.fn(),
  groupList: vi.fn(),
  groupSave: vi.fn(),
  execute: vi.fn(),
}
const terminalApi = {
  onData: vi.fn().mockReturnValue(() => {}),
  onExit: vi.fn().mockReturnValue(() => {}),
  write: vi.fn(),
  kill: vi.fn(),
}

beforeEach(() => {
  for (const fn of Object.values(buttonApi)) (fn as any).mockReset()
  ;(window as any).api = { button: buttonApi, terminal: terminalApi }
  useButtonStore.setState({ buttons: [], groups: [], runningButtons: {} } as any)
  useToastStore.setState({ toasts: [] })
})

const B = (overrides: Partial<{ id: string; placement: string; order: number; groupId?: string; scope: any }> = {}) => ({
  id: 'b1',
  label: 'Test',
  command: 'echo hi',
  placement: 'session-toolbar',
  scope: { type: 'global' },
  actionType: 'shell',
  executionMode: 'background',
  order: 0,
  ...overrides,
}) as any

const G = (overrides: Partial<{ id: string; placement: string; order: number; scope: any }> = {}) => ({
  id: 'g1',
  label: 'My Group',
  placement: 'session-toolbar',
  scope: { type: 'global' },
  order: 0,
  ...overrides,
}) as any

describe('buttonStore.loadButtons / loadGroups', () => {
  it('loadButtons stores api result', async () => {
    buttonApi.list.mockResolvedValue([B({ id: 'b1' })])
    await useButtonStore.getState().loadButtons()
    expect(useButtonStore.getState().buttons).toHaveLength(1)
  })

  it('loadButtons toasts on error', async () => {
    buttonApi.list.mockRejectedValue(new Error('disk full'))
    await useButtonStore.getState().loadButtons()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })

  it('loadGroups stores api result', async () => {
    buttonApi.groupList.mockResolvedValue([G({ id: 'g1' })])
    await useButtonStore.getState().loadGroups()
    expect(useButtonStore.getState().groups).toHaveLength(1)
  })
})

describe('buttonStore.add/update/remove (buttons + groups)', () => {
  it('addButton appends and persists', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    await useButtonStore.getState().addButton(B({ id: 'b1' }))
    expect(useButtonStore.getState().buttons).toHaveLength(1)
    expect(buttonApi.save).toHaveBeenCalled()
  })

  it('updateButton replaces by id', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1' }), B({ id: 'b2' })],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().updateButton(B({ id: 'b1', label: 'updated' as any } as any))
    const b = useButtonStore.getState().buttons.find((x: any) => x.id === 'b1') as any
    expect(b.label).toBe('updated')
  })

  it('removeButton drops by id', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1' }), B({ id: 'b2' })],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().removeButton('b1')
    expect(useButtonStore.getState().buttons.map((x: any) => x.id)).toEqual(['b2'])
  })

  it('removeGroup ungroups its buttons', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    buttonApi.groupSave.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [B({ id: 'b1', groupId: 'g1' }), B({ id: 'b2' })],
      groups: [G({ id: 'g1' })],
      runningButtons: {},
    } as any)
    await useButtonStore.getState().removeGroup('g1')
    expect(useButtonStore.getState().groups).toEqual([])
    const b1 = useButtonStore.getState().buttons.find((b: any) => b.id === 'b1') as any
    expect(b1.groupId).toBeUndefined()
  })
})

describe('buttonStore.reorderButtons', () => {
  it('rewrites the order index for buttons in the placement', async () => {
    buttonApi.save.mockResolvedValue(undefined)
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', order: 0 }),
        B({ id: 'b2', order: 1 }),
        B({ id: 'b3', order: 2, placement: 'project-tabs' as any }),
      ],
      groups: [], runningButtons: {},
    } as any)
    await useButtonStore.getState().reorderButtons('session-toolbar' as any, ['b2', 'b1'])
    const sessionButtons = useButtonStore.getState().buttons.filter((b: any) => b.placement === 'session-toolbar')
    expect(sessionButtons.find((b: any) => b.id === 'b2').order).toBe(0)
    expect(sessionButtons.find((b: any) => b.id === 'b1').order).toBe(1)
    // project-tabs button untouched
    expect(useButtonStore.getState().buttons.find((b: any) => b.id === 'b3').order).toBe(2)
  })
})

describe('buttonStore.getButtonsForPlacement / getGroupedButtons', () => {
  it('filters by placement and scope, sorts by order', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', placement: 'session-toolbar' as any, order: 1 }),
        B({ id: 'b2', placement: 'session-toolbar' as any, order: 0 }),
        B({ id: 'b3', placement: 'project-tabs' as any, order: 0 }),
        B({ id: 'b4', placement: 'session-toolbar' as any, order: 2, scope: { type: 'projects', projectIds: ['p1'] } }),
      ],
      groups: [], runningButtons: {},
    } as any)
    const result = useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, null)
    // b4 requires p1, null scope filters it out; b2 then b1 by order
    expect(result.map((b: any) => b.id)).toEqual(['b2', 'b1'])
  })

  it('matches projects scope correctly', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', scope: { type: 'projects', projectIds: ['p1'] } as any }),
        B({ id: 'b2', scope: { type: 'projects', projectIds: ['p2'] } as any }),
        B({ id: 'b3', scope: { type: 'all-projects' } as any }),
      ],
      groups: [], runningButtons: {},
    } as any)
    const ids = useButtonStore.getState().getButtonsForPlacement('session-toolbar' as any, 'p1').map((b: any) => b.id)
    expect(ids).toContain('b1')
    expect(ids).toContain('b3')
    expect(ids).not.toContain('b2')
  })

  it('groups buttons under their groups and lists ungrouped separately', () => {
    useButtonStore.setState({
      buttons: [
        B({ id: 'b1', groupId: 'g1', order: 0 }),
        B({ id: 'b2', groupId: 'g1', order: 1 }),
        B({ id: 'b3', order: 2 }),
      ],
      groups: [G({ id: 'g1', order: 0 })],
      runningButtons: {},
    } as any)
    const { ungrouped, groups } = useButtonStore.getState().getGroupedButtons('session-toolbar' as any, null)
    expect(ungrouped.map((b: any) => b.id)).toEqual(['b3'])
    expect(groups[0].group.id).toBe('g1')
    expect(groups[0].buttons.map((b: any) => b.id)).toEqual(['b1', 'b2'])
  })
})

describe('buttonStore.setButtonRunState', () => {
  it('sets and clears running state', () => {
    useButtonStore.getState().setButtonRunState('b1', { terminalId: 't1', running: true })
    expect(useButtonStore.getState().runningButtons.b1).toEqual({ terminalId: 't1', running: true })
    useButtonStore.getState().setButtonRunState('b1', null)
    expect(useButtonStore.getState().runningButtons.b1).toBeUndefined()
  })
})

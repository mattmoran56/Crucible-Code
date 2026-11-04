import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PR_DESK_UI, deskProject, usePRDeskStore } from '../../../src/renderer/stores/prDeskStore'

const list = vi.fn()
const tickets = vi.fn()
const getParked = vi.fn()
const setParked = vi.fn()

beforeEach(() => {
  for (const fn of [list, tickets, getParked, setParked]) fn.mockReset()
  ;(window as any).api = { prDesk: { list, tickets, getParked, setParked, openExternal: vi.fn() } }
  usePRDeskStore.setState({ ...DEFAULT_PR_DESK_UI, byProject: {} })
})

const PR = (n: number, pageId: string | null) => ({ number: n, ticket: pageId ? { ticketId: null, pageId, url: null } : null }) as any

describe('prDeskStore', () => {
  it('loads PRs then their tickets', async () => {
    list.mockResolvedValue([PR(1, 'abc'), PR(2, null)])
    tickets.mockResolvedValue({ configured: true, tickets: { abc: { title: 'T' } } })
    await usePRDeskStore.getState().load('p', '/repo')
    expect(list).toHaveBeenCalledWith('/repo')
    expect(tickets).toHaveBeenCalledWith('p', [{ ticketId: null, pageId: 'abc', url: null }])
    const data = deskProject(usePRDeskStore.getState(), 'p')
    expect(data.prs).toHaveLength(2)
    expect(data.tickets.abc).toEqual({ title: 'T' })
    expect(data.notionConfigured).toBe(true)
    expect(data.hasLoaded).toBe(true)
  })

  it('records a gh failure without asking Notion', async () => {
    list.mockRejectedValue(new Error('gh: not logged in'))
    await usePRDeskStore.getState().load('p', '/repo')
    expect(deskProject(usePRDeskStore.getState(), 'p').error).toBe('gh: not logged in')
    expect(tickets).not.toHaveBeenCalled()
  })

  it('toggles manual parks and persists them', async () => {
    getParked.mockResolvedValue([3])
    await usePRDeskStore.getState().loadParked('p')
    usePRDeskStore.getState().toggleParked('p', 4)
    expect(setParked).toHaveBeenLastCalledWith('p', [3, 4])
    usePRDeskStore.getState().toggleParked('p', 3)
    expect(setParked).toHaveBeenLastCalledWith('p', [4])
  })

  it('updates UI settings', () => {
    usePRDeskStore.getState().setUI({ open: true, view: 'expanded', height: 400 })
    const s = usePRDeskStore.getState()
    expect([s.open, s.view, s.height]).toEqual([true, 'expanded', 400])
  })
})

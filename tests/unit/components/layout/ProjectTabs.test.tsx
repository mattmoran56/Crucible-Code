import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('../../../../src/renderer/components/buttons/CustomButtonBar', () => ({ CustomButtonBar: () => null }))
vi.mock('../../../../src/renderer/components/layout/RemoteTogglePopover', () => ({ RemoteTogglePopover: () => null }))

import { ProjectTabs } from '../../../../src/renderer/components/layout/ProjectTabs'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'

const projects = [
  { id: 'a', name: 'alpha', repoPath: '/a' },
  { id: 'b', name: 'beta', repoPath: '/b' },
  { id: 'c', name: 'gamma', repoPath: '/c' },
]

// jsdom has no layout: the strip measures as starting at x=0 with the default
// 176px tabs, 177px apart (gap is 0 here, so the slot is the tab width).
const SLOT = 176

let reorder: ReturnType<typeof vi.fn>

// jsdom has no PointerEvent; testing-library then drops clientX/button.
if (typeof (globalThis as any).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  ;(globalThis as any).PointerEvent = PointerEventPolyfill
}

beforeEach(() => {
  reorder = vi.fn(async (ids: string[]) => ids.map((id) => projects.find((p) => p.id === id)!))
  ;(window as any).api = {
    update: { onStatus: () => () => {}, onLog: () => () => {}, apply: vi.fn() },
    project: { reorder },
  }
  useProjectStore.setState({ projects, activeProjectId: 'a', windowId: null, tabIds: [] })
})

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent?.replace('×', '').trim())

describe('ProjectTabs dragging without a window manager', () => {
  it('reorders tabs live and commits on release', async () => {
    render(<ProjectTabs />)
    fireEvent.pointerDown(screen.getByRole('tab', { name: /alpha/ }), { button: 0, clientX: 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 10 + SLOT * 2, clientY: 12 })
    expect(tabNames()).toEqual(['beta', 'gamma', 'alpha'])
    expect(reorder).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 10 + SLOT * 2, clientY: 12 })
    })
    expect(reorder).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('Escape puts the tabs back', () => {
    render(<ProjectTabs />)
    fireEvent.pointerDown(screen.getByRole('tab', { name: /gamma/ }), { button: 0, clientX: SLOT * 2 + 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 })
    expect(tabNames()).toEqual(['gamma', 'alpha', 'beta'])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(tabNames()).toEqual(['alpha', 'beta', 'gamma'])
    fireEvent.pointerUp(window, { clientX: 10, clientY: 10 })
    expect(reorder).not.toHaveBeenCalled()
  })

  it('a press without movement is still a click', () => {
    render(<ProjectTabs />)
    const beta = screen.getByRole('tab', { name: /beta/ })
    fireEvent.pointerDown(beta, { button: 0, clientX: SLOT + 10, clientY: 10 })
    fireEvent.pointerMove(window, { clientX: SLOT + 11, clientY: 10 })
    fireEvent.pointerUp(window, { clientX: SLOT + 11, clientY: 10 })
    fireEvent.click(beta)
    expect(useProjectStore.getState().activeProjectId).toBe('b')
    expect(reorder).not.toHaveBeenCalled()
  })
})

describe('ProjectTabs dragging with a window manager', () => {
  it('hands the drag to main and reports release', () => {
    const tabDragStart = vi.fn(async () => {})
    const tabDragEnd = vi.fn(async () => {})
    ;(window as any).api.windows = {
      tabDragStart,
      tabDragEnd,
      reportTabStrip: vi.fn(async () => {}),
      setLayout: vi.fn(async () => null),
      list: vi.fn(async () => []),
    }
    useProjectStore.setState({ windowId: 'w1', tabIds: ['a', 'b', 'c'] })
    render(<ProjectTabs />)
    expect((window as any).api.windows.reportTabStrip).toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('tab', { name: /beta/ }), { button: 0, clientX: SLOT + 30, clientY: 12 })
    fireEvent.pointerMove(window, { clientX: SLOT + 30, clientY: 80 })
    // Grab offset within the tab (jsdom rects are all at 0,0).
    expect(tabDragStart).toHaveBeenCalledWith('b', { x: SLOT + 30, y: 12 })
    // Main does the reordering; the renderer doesn't reorder on its own.
    expect(tabNames()).toEqual(['alpha', 'beta', 'gamma'])
    fireEvent.pointerUp(window, { clientX: SLOT + 30, clientY: 80, altKey: true })
    expect(tabDragEnd).toHaveBeenCalledWith({ cancel: false, copy: true })
  })
})

describe('ProjectTabs hidden projects', () => {
  it('does not show hidden projects as tabs', () => {
    useProjectStore.setState({ projects: [projects[0], { ...projects[1], hidden: true }, projects[2]] })
    render(<ProjectTabs />)
    expect(tabNames()).toEqual(['alpha', 'gamma'])
  })

  it('right-click → Hide Project hides it', async () => {
    const update = vi.fn(async (p: any) => projects.map((q) => (q.id === p.id ? p : q)))
    ;(window as any).api.project.update = update
    render(<ProjectTabs />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: /beta/ }))
    await act(async () => {
      fireEvent.click(await screen.findByText('Hide Project'))
    })
    expect(update).toHaveBeenCalledWith({ ...projects[1], hidden: true })
    expect(tabNames()).toEqual(['alpha', 'gamma'])
  })
})

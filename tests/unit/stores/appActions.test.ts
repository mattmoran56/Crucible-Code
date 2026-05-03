import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getAppAction,
  getAppActions,
  getAppActionGroups,
} from '../../../src/renderer/stores/appActions'
import { useSessionStore } from '../../../src/renderer/stores/sessionStore'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useWorkspaceLayoutStore } from '../../../src/renderer/stores/workspaceLayoutStore'
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore'

beforeEach(() => {
  ;(window as any).api = {} // touched only by stores when sessions/projects are set
  useSessionStore.setState({ sessions: [], activeSessionId: null } as any)
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] } as any)
  useWorkspaceLayoutStore.setState({ columns: [{ id: 'c1', tabs: [], activeTab: undefined, flex: 1 }], savedLayouts: {} } as any)
  useSettingsStore.setState({ isOpen: false } as any)
})

describe('getAppActions', () => {
  it('returns a non-empty list', () => {
    expect(getAppActions().length).toBeGreaterThan(0)
  })

  it('every action has the required metadata', () => {
    for (const a of getAppActions()) {
      expect(typeof a.id).toBe('string')
      expect(typeof a.label).toBe('string')
      expect(typeof a.group).toBe('string')
      expect(Array.isArray(a.validPlacements)).toBe(true)
      expect(typeof a.execute).toBe('function')
    }
  })

  it('every action id is unique', () => {
    const ids = getAppActions().map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes the well-known session/tabs/project/app actions', () => {
    const ids = getAppActions().map((a) => a.id)
    expect(ids).toContain('session:create')
    expect(ids).toContain('session:delete')
    expect(ids).toContain('tab:open-agent')
    expect(ids).toContain('tab:open-terminal')
    expect(ids).toContain('tab:split-right')
    expect(ids).toContain('project:add')
    expect(ids).toContain('app:open-settings')
  })
})

describe('getAppAction', () => {
  it('returns the matching action when present', () => {
    expect(getAppAction('app:open-settings')).toBeDefined()
    expect(getAppAction('app:open-settings')!.label).toBe('Open Settings')
  })

  it('returns undefined for unknown ids', () => {
    expect(getAppAction('does-not-exist')).toBeUndefined()
  })
})

describe('getAppActionGroups', () => {
  it('groups by the .group field, preserving every action', () => {
    const groups = getAppActionGroups()
    const total = groups.reduce((sum, g) => sum + g.actions.length, 0)
    expect(total).toBe(getAppActions().length)
    for (const g of groups) {
      for (const a of g.actions) expect(a.group).toBe(g.group)
    }
  })
})

describe('action.execute (side effects)', () => {
  it('app:open-settings opens the settings dialog', () => {
    const action = getAppAction('app:open-settings')!
    action.execute()
    expect(useSettingsStore.getState().isOpen).toBe(true)
  })

  it('tab:open-agent adds an agent tab to the first column', () => {
    const action = getAppAction('tab:open-agent')!
    action.execute()
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs.some((t) => t === 'agent' || t.toString().startsWith('agent:'))).toBe(true)
  })

  it('tab:open-terminal adds a terminal tab to the first column', () => {
    const action = getAppAction('tab:open-terminal')!
    action.execute()
    const cols = useWorkspaceLayoutStore.getState().columns
    expect(cols[0].tabs.some((t) => t.toString().startsWith('terminal:'))).toBe(true)
  })

  it('tab:split-right adds a new column', () => {
    const action = getAppAction('tab:split-right')!
    action.execute()
    expect(useWorkspaceLayoutStore.getState().columns.length).toBe(2)
  })

  it('session:create dispatches a window event', () => {
    const handler = vi.fn()
    window.addEventListener('app:create-session', handler)
    getAppAction('session:create')!.execute()
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('app:create-session', handler)
  })

  it('app:toggle-notes dispatches an app:toggle-panel event with the right detail', () => {
    let detail: any = null
    window.addEventListener('app:toggle-panel', (e) => { detail = (e as CustomEvent).detail }, { once: true })
    getAppAction('app:toggle-notes')!.execute()
    expect(detail).toEqual({ panel: 'notes' })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'

const list = vi.fn()
const add = vi.fn()
const remove = vi.fn()
const reorder = vi.fn()
const selectFolder = vi.fn()
const update = vi.fn()
const accountList = vi.fn()
const accountSave = vi.fn()

beforeEach(() => {
  for (const fn of [list, add, remove, reorder, selectFolder, update, accountList, accountSave]) fn.mockReset()
  ;(window as any).api = {
    project: { list, add, remove, reorder, selectFolder, update },
    account: { list: accountList, save: accountSave },
  }
  useProjectStore.setState({ projects: [], activeProjectId: null, claudeAccounts: [] })
})

const P = (overrides: Partial<{ id: string; name: string; repoPath: string }> = {}) => ({
  id: 'p1',
  name: 'A',
  repoPath: '/a',
  ...overrides,
}) as any

describe('projectStore.loadProjects', () => {
  it('sets activeProjectId to the first project when none is active', async () => {
    list.mockResolvedValue([P({ id: 'p1' }), P({ id: 'p2' })])
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBe('p1')
  })

  it('keeps the existing activeProjectId across reloads', async () => {
    useProjectStore.setState({ activeProjectId: 'p2' } as any)
    list.mockResolvedValue([P({ id: 'p1' }), P({ id: 'p2' })])
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBe('p2')
  })

  it('clears activeProjectId when there are no projects', async () => {
    useProjectStore.setState({ activeProjectId: 'p1' } as any)
    list.mockResolvedValue([])
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })
})

describe('projectStore.addProject', () => {
  it('does nothing if folder selection is cancelled', async () => {
    selectFolder.mockResolvedValue(null)
    await useProjectStore.getState().addProject()
    expect(add).not.toHaveBeenCalled()
  })

  it('adds with a name derived from the folder basename and selects it', async () => {
    selectFolder.mockResolvedValue('/Users/me/projects/my-app')
    const newList = [P({ id: 'pX', name: 'my-app', repoPath: '/Users/me/projects/my-app' })]
    add.mockResolvedValue(newList)
    await useProjectStore.getState().addProject()
    expect(add).toHaveBeenCalled()
    const sent = add.mock.calls[0][0]
    expect(sent.name).toBe('my-app')
    expect(sent.repoPath).toBe('/Users/me/projects/my-app')
    expect(useProjectStore.getState().projects).toEqual(newList)
    expect(useProjectStore.getState().activeProjectId).toBe(sent.id)
  })
})

describe('projectStore.removeProject', () => {
  it('clears activeProjectId when the active project is removed and there are no others', async () => {
    useProjectStore.setState({
      projects: [P({ id: 'p1' })],
      activeProjectId: 'p1',
    } as any)
    remove.mockResolvedValue([])
    await useProjectStore.getState().removeProject('p1')
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })

  it('falls back to the first remaining project when removing the active one', async () => {
    useProjectStore.setState({
      projects: [P({ id: 'p1' }), P({ id: 'p2' })],
      activeProjectId: 'p1',
    } as any)
    remove.mockResolvedValue([P({ id: 'p2' })])
    await useProjectStore.getState().removeProject('p1')
    expect(useProjectStore.getState().activeProjectId).toBe('p2')
  })

  it('keeps activeProjectId when a non-active project is removed', async () => {
    useProjectStore.setState({
      projects: [P({ id: 'p1' }), P({ id: 'p2' })],
      activeProjectId: 'p1',
    } as any)
    remove.mockResolvedValue([P({ id: 'p1' })])
    await useProjectStore.getState().removeProject('p2')
    expect(useProjectStore.getState().activeProjectId).toBe('p1')
  })
})

describe('projectStore.setActiveProject / updateProject / reorderProjects', () => {
  it('setActiveProject just stores the id', () => {
    useProjectStore.getState().setActiveProject('p9')
    expect(useProjectStore.getState().activeProjectId).toBe('p9')
  })

  it('updateProject pushes through and replaces projects from server', async () => {
    update.mockResolvedValue([P({ id: 'p1', name: 'renamed' })])
    await useProjectStore.getState().updateProject(P({ id: 'p1', name: 'renamed' }))
    expect(useProjectStore.getState().projects[0].name).toBe('renamed')
  })

  it('reorderProjects forwards ids and replaces projects', async () => {
    reorder.mockResolvedValue([P({ id: 'p2' }), P({ id: 'p1' })])
    await useProjectStore.getState().reorderProjects(['p2', 'p1'])
    expect(reorder).toHaveBeenCalledWith(['p2', 'p1'])
    expect(useProjectStore.getState().projects.map((p: any) => p.id)).toEqual(['p2', 'p1'])
  })
})

describe('projectStore.loadAccounts / saveAccounts', () => {
  it('loadAccounts pulls from api', async () => {
    accountList.mockResolvedValue([{ id: 'a1', label: 'me', configDir: '/' }])
    await useProjectStore.getState().loadAccounts()
    expect(useProjectStore.getState().claudeAccounts).toHaveLength(1)
  })

  it('saveAccounts pushes to api and updates state', async () => {
    accountSave.mockResolvedValue(undefined)
    await useProjectStore.getState().saveAccounts([{ id: 'a1', label: 'me', configDir: '/' } as any])
    expect(accountSave).toHaveBeenCalled()
    expect(useProjectStore.getState().claudeAccounts).toHaveLength(1)
  })
})

describe('projectStore.addProject (extended)', () => {
  it('generates a uuid id and sends it to the backend', async () => {
    selectFolder.mockResolvedValue('/projects/demo')
    add.mockImplementation(async (p: any) => [p])
    await useProjectStore.getState().addProject()
    const sent = add.mock.calls[0][0]
    expect(typeof sent.id).toBe('string')
    expect(sent.id.length).toBeGreaterThan(0)
    expect(useProjectStore.getState().activeProjectId).toBe(sent.id)
  })

  it('falls back to the full path as name when basename is empty (trailing slash)', async () => {
    // Current behavior: '/x/y/'.split('/').pop() is '' → name falls back to the whole path
    selectFolder.mockResolvedValue('/projects/demo/')
    add.mockImplementation(async (p: any) => [p])
    await useProjectStore.getState().addProject()
    expect(add.mock.calls[0][0].name).toBe('/projects/demo/')
  })

  it('does not call add when selectFolder resolves to empty string', async () => {
    selectFolder.mockResolvedValue('')
    await useProjectStore.getState().addProject()
    expect(add).not.toHaveBeenCalled()
  })
})

describe('projectStore.loadProjects (extended)', () => {
  it('keeps a stale activeProjectId even when it is missing from the new list', async () => {
    // Current behavior: activeProjectId is only replaced when it is null
    useProjectStore.setState({ activeProjectId: 'ghost' } as any)
    list.mockResolvedValue([P({ id: 'p1' })])
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().activeProjectId).toBe('ghost')
  })

  it('replaces the projects array with the api result', async () => {
    useProjectStore.setState({ projects: [P({ id: 'old' })] } as any)
    list.mockResolvedValue([P({ id: 'new1' }), P({ id: 'new2' })])
    await useProjectStore.getState().loadProjects()
    expect(useProjectStore.getState().projects.map((p: any) => p.id)).toEqual(['new1', 'new2'])
  })
})

describe('projectStore.removeProject (extended)', () => {
  it('leaves activeProjectId null when nothing was active', async () => {
    useProjectStore.setState({ projects: [P({ id: 'p1' })], activeProjectId: null } as any)
    remove.mockResolvedValue([])
    await useProjectStore.getState().removeProject('p1')
    expect(useProjectStore.getState().activeProjectId).toBeNull()
  })

  it('forwards the id to the api', async () => {
    remove.mockResolvedValue([])
    await useProjectStore.getState().removeProject('p7')
    expect(remove).toHaveBeenCalledWith('p7')
  })
})

describe('projectStore accounts (extended)', () => {
  it('loadAccounts replaces any previously loaded accounts', async () => {
    useProjectStore.setState({ claudeAccounts: [{ id: 'old' } as any] })
    accountList.mockResolvedValue([{ id: 'fresh', label: 'f', configDir: '/f' }])
    await useProjectStore.getState().loadAccounts()
    expect(useProjectStore.getState().claudeAccounts.map((a: any) => a.id)).toEqual(['fresh'])
  })

  it('saveAccounts with an empty array clears local state', async () => {
    useProjectStore.setState({ claudeAccounts: [{ id: 'a1' } as any] })
    accountSave.mockResolvedValue(undefined)
    await useProjectStore.getState().saveAccounts([])
    expect(accountSave).toHaveBeenCalledWith([])
    expect(useProjectStore.getState().claudeAccounts).toEqual([])
  })
})

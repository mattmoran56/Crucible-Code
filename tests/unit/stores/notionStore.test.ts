import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_NOTION_CONFIG,
  useNotionStore,
} from '../../../src/renderer/stores/notionStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const loadConfig = vi.fn()
const saveConfig = vi.fn()
const testConnection = vi.fn()
const getDatabaseSchema = vi.fn()
const clearPickedUp = vi.fn()
const getConfigPath = vi.fn()

beforeEach(() => {
  loadConfig.mockReset()
  saveConfig.mockReset()
  testConnection.mockReset()
  getDatabaseSchema.mockReset()
  clearPickedUp.mockReset()
  getConfigPath.mockReset()
  ;(window as any).api = {
    notion: {
      loadConfig,
      saveConfig,
      testConnection,
      getDatabaseSchema,
      clearPickedUp,
      getConfigPath,
    },
  }
  useNotionStore.setState({
    configByProject: {},
    schemaByProject: {},
    loadingProjects: new Set(),
    configPath: null,
  })
  useToastStore.setState({ toasts: [] })
})

describe('notionStore.load', () => {
  it('seeds with the default config when the backend returns null', async () => {
    loadConfig.mockResolvedValue(null)
    await useNotionStore.getState().load('p1')
    expect(useNotionStore.getState().configByProject.p1).toEqual(DEFAULT_NOTION_CONFIG)
  })

  it('stores the backend config under the projectId', async () => {
    const config = { ...DEFAULT_NOTION_CONFIG, enabled: true, apiToken: 'secret_x' }
    loadConfig.mockResolvedValue(config)
    await useNotionStore.getState().load('p1')
    expect(useNotionStore.getState().configByProject.p1).toEqual(config)
  })

  it('skips reentrant loads while one is already in flight', async () => {
    let resolve: (v: any) => void = () => {}
    loadConfig.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const first = useNotionStore.getState().load('p1')
    await useNotionStore.getState().load('p1') // bails because in-flight
    expect(loadConfig).toHaveBeenCalledTimes(1)
    resolve(null)
    await first
  })

  it('emits an error toast when the api throws', async () => {
    loadConfig.mockRejectedValue(new Error('disk full'))
    await useNotionStore.getState().load('p1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })
})

describe('notionStore.save', () => {
  it('writes the config through the api and updates local state', async () => {
    saveConfig.mockResolvedValue(undefined)
    const config = { ...DEFAULT_NOTION_CONFIG, enabled: true, databaseId: 'abc' }
    await useNotionStore.getState().save('p1', config)
    expect(saveConfig).toHaveBeenCalledWith('p1', config, undefined)
    expect(useNotionStore.getState().configByProject.p1).toEqual(config)
  })

  it('forwards the backfill option', async () => {
    saveConfig.mockResolvedValue(undefined)
    await useNotionStore.getState().save('p1', DEFAULT_NOTION_CONFIG, { backfill: true })
    expect(saveConfig).toHaveBeenCalledWith('p1', DEFAULT_NOTION_CONFIG, { backfill: true })
  })

  it('toasts on backend errors', async () => {
    saveConfig.mockRejectedValue(new Error('locked'))
    await useNotionStore.getState().save('p1', DEFAULT_NOTION_CONFIG)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'locked' })
  })
})

describe('notionStore.testConnection', () => {
  it('forwards the result from the backend', async () => {
    testConnection.mockResolvedValue({ ok: true, taskCount: 5 })
    const out = await useNotionStore.getState().testConnection('tok', 'db')
    expect(out).toEqual({ ok: true, taskCount: 5 })
    expect(testConnection).toHaveBeenCalledWith('tok', 'db')
  })
})

describe('notionStore.loadSchema', () => {
  it('stores the schema under the projectId', async () => {
    const schema = {
      id: 'db1',
      title: 'Tasks',
      titlePropertyName: 'Task',
      properties: [{ name: 'Task', type: 'title' }],
    }
    getDatabaseSchema.mockResolvedValue(schema)
    await useNotionStore.getState().loadSchema('p1', 'tok', 'db')
    expect(useNotionStore.getState().schemaByProject.p1).toEqual(schema)
  })

  it('toasts on errors and leaves the schema map untouched', async () => {
    getDatabaseSchema.mockRejectedValue(new Error('Unauthorized'))
    await useNotionStore.getState().loadSchema('p1', 'tok', 'db')
    expect(useNotionStore.getState().schemaByProject.p1).toBeUndefined()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'Unauthorized' })
  })
})

describe('notionStore.clearPickedUp', () => {
  it('calls the backend and toasts success', async () => {
    clearPickedUp.mockResolvedValue(undefined)
    await useNotionStore.getState().clearPickedUp('p1')
    expect(clearPickedUp).toHaveBeenCalledWith('p1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'success' })
  })
})

describe('notionStore.loadConfigPath', () => {
  it('caches the config path for the MCP prompt UI', async () => {
    getConfigPath.mockResolvedValue('/Users/dev/Library/Application Support/Crucible/dev/notion-integration.json')
    await useNotionStore.getState().loadConfigPath()
    expect(useNotionStore.getState().configPath).toContain('notion-integration.json')
  })
})

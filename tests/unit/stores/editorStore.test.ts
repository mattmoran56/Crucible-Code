import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '../../../src/renderer/stores/editorStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const stat = vi.fn()
const read = vi.fn()
const write = vi.fn()
const create = vi.fn()
const status = vi.fn()

beforeEach(() => {
  for (const fn of [stat, read, write, create, status]) fn.mockReset()
  ;(window as any).api = {
    file: { stat, read, write, create },
    git: { status },
  }
  useEditorStore.setState({
    editorMode: false,
    openFiles: [],
    activeFilePath: null,
    currentBranch: null,
    pendingLargeFile: null,
  })
  useToastStore.setState({ toasts: [] })
})

describe('editorStore.setEditorMode', () => {
  it('toggles editorMode', () => {
    useEditorStore.getState().setEditorMode(true)
    expect(useEditorStore.getState().editorMode).toBe(true)
    useEditorStore.getState().setEditorMode(false)
    expect(useEditorStore.getState().editorMode).toBe(false)
  })
})

describe('editorStore.openFile', () => {
  it('toasts when the file does not exist', async () => {
    stat.mockResolvedValue({ exists: false, size: 0 })
    await useEditorStore.getState().openFile('/x.ts', '/repo')
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'File not found: /x.ts',
    })
  })

  it('flags large files for a confirmation dialog without reading them', async () => {
    stat.mockResolvedValue({ exists: true, size: 5 * 1024 * 1024 })
    await useEditorStore.getState().openFile('/big.ts', '/repo')
    expect(useEditorStore.getState().pendingLargeFile).toEqual({
      path: '/big.ts',
      size: 5 * 1024 * 1024,
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('opens small files immediately, infers language and name', async () => {
    stat.mockResolvedValue({ exists: true, size: 100 })
    read.mockResolvedValue('console.log("hi")')
    await useEditorStore.getState().openFile('/src/foo/bar.ts', '/repo')
    const f = useEditorStore.getState().openFiles[0]
    expect(f.path).toBe('/src/foo/bar.ts')
    expect(f.name).toBe('bar.ts')
    expect(f.language).toBe('typescript')
    expect(f.content).toBe('console.log("hi")')
    expect(useEditorStore.getState().activeFilePath).toBe('/src/foo/bar.ts')
  })

  it('does not re-fetch when the file is already open — it just activates', async () => {
    useEditorStore.setState({
      openFiles: [{
        path: '/a.ts', name: 'a.ts', content: '', savedContent: '', language: 'typescript',
      }],
      activeFilePath: null,
    })
    await useEditorStore.getState().openFile('/a.ts', '/repo')
    expect(stat).not.toHaveBeenCalled()
    expect(useEditorStore.getState().activeFilePath).toBe('/a.ts')
  })
})

describe('editorStore.forceOpenFile', () => {
  it('reads non-image files via the api', async () => {
    read.mockResolvedValue('content')
    await useEditorStore.getState().forceOpenFile('/a.ts', '/repo')
    expect(read).toHaveBeenCalledWith('/a.ts', '/repo')
    expect(useEditorStore.getState().openFiles[0].content).toBe('content')
  })

  it('opens images with empty content (rendered by a separate component)', async () => {
    await useEditorStore.getState().forceOpenFile('/icon.png', '/repo')
    expect(read).not.toHaveBeenCalled()
    expect(useEditorStore.getState().openFiles[0].content).toBe('')
    expect(useEditorStore.getState().openFiles[0].language).toBe('text')
  })
})

describe('editorStore.dismissLargeFile', () => {
  it('clears the pending large file flag', () => {
    useEditorStore.setState({ pendingLargeFile: { path: '/big', size: 1 } })
    useEditorStore.getState().dismissLargeFile()
    expect(useEditorStore.getState().pendingLargeFile).toBeNull()
  })
})

describe('editorStore.closeFile', () => {
  it('removes the file and activates the next tab', async () => {
    useEditorStore.setState({
      openFiles: [
        { path: '/a', name: 'a', content: '', savedContent: '', language: 'text' },
        { path: '/b', name: 'b', content: '', savedContent: '', language: 'text' },
        { path: '/c', name: 'c', content: '', savedContent: '', language: 'text' },
      ],
      activeFilePath: '/b',
    })
    await useEditorStore.getState().closeFile('/b')
    expect(useEditorStore.getState().openFiles.map((f: any) => f.path)).toEqual(['/a', '/c'])
    expect(useEditorStore.getState().activeFilePath).toBe('/c')
  })

  it('keeps activeFilePath unchanged when closing a non-active tab', async () => {
    useEditorStore.setState({
      openFiles: [
        { path: '/a', name: 'a', content: '', savedContent: '', language: 'text' },
        { path: '/b', name: 'b', content: '', savedContent: '', language: 'text' },
      ],
      activeFilePath: '/a',
    })
    await useEditorStore.getState().closeFile('/b')
    expect(useEditorStore.getState().activeFilePath).toBe('/a')
  })

  it('clears activeFilePath when the last tab is closed', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: '', savedContent: '', language: 'text' }],
      activeFilePath: '/a',
    })
    await useEditorStore.getState().closeFile('/a')
    expect(useEditorStore.getState().activeFilePath).toBeNull()
  })
})

describe('editorStore.updateFileContent', () => {
  it('updates content but leaves savedContent unchanged (so dirty marker still shows)', () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'old', savedContent: 'old', language: 'text' }],
    })
    useEditorStore.getState().updateFileContent('/a', 'new')
    const file = useEditorStore.getState().openFiles[0] as any
    expect(file.content).toBe('new')
    expect(file.savedContent).toBe('old')
  })
})

describe('editorStore.saveFile', () => {
  it('writes through and updates savedContent on success', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'new', savedContent: 'old', language: 'text' }],
    })
    write.mockResolvedValue(undefined)
    await useEditorStore.getState().saveFile('/a', '/repo')
    expect(write).toHaveBeenCalledWith('/a', 'new', '/repo')
    expect((useEditorStore.getState().openFiles[0] as any).savedContent).toBe('new')
  })

  it('does nothing when the file is not dirty', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'x', savedContent: 'x', language: 'text' }],
    })
    await useEditorStore.getState().saveFile('/a', '/repo')
    expect(write).not.toHaveBeenCalled()
  })

  it('emits a toast on write error', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'new', savedContent: 'old', language: 'text' }],
    })
    write.mockRejectedValue(new Error('readonly'))
    await useEditorStore.getState().saveFile('/a', '/repo')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'readonly' })
  })
})

describe('editorStore.saveActiveFile', () => {
  it('saves the active file', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'new', savedContent: 'old', language: 'text' }],
      activeFilePath: '/a',
    })
    write.mockResolvedValue(undefined)
    await useEditorStore.getState().saveActiveFile('/repo')
    expect(write).toHaveBeenCalled()
  })

  it('is a no-op when there is no active file', async () => {
    await useEditorStore.getState().saveActiveFile('/repo')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('editorStore.loadBranch', () => {
  it('stores git status.current', async () => {
    status.mockResolvedValue({ current: 'feat/x' })
    await useEditorStore.getState().loadBranch('/repo')
    expect(useEditorStore.getState().currentBranch).toBe('feat/x')
  })

  it('falls back to null on git error', async () => {
    status.mockRejectedValue(new Error('not a repo'))
    await useEditorStore.getState().loadBranch('/repo')
    expect(useEditorStore.getState().currentBranch).toBeNull()
  })
})

describe('editorStore.handleExternalChange', () => {
  it('reloads content when the file is clean', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'old', savedContent: 'old', language: 'text' }],
    })
    read.mockResolvedValue('fresh')
    await useEditorStore.getState().handleExternalChange('/a', '/repo')
    const f = useEditorStore.getState().openFiles[0] as any
    expect(f.content).toBe('fresh')
    expect(f.savedContent).toBe('fresh')
  })

  it('keeps in-memory edits when the file is dirty', async () => {
    useEditorStore.setState({
      openFiles: [{ path: '/a', name: 'a', content: 'edited', savedContent: 'old', language: 'text' }],
    })
    await useEditorStore.getState().handleExternalChange('/a', '/repo')
    expect(read).not.toHaveBeenCalled()
  })

  it('is a no-op for files that are not open', async () => {
    await useEditorStore.getState().handleExternalChange('/a', '/repo')
    expect(read).not.toHaveBeenCalled()
  })
})

import { create } from 'zustand'
import { useToastStore } from './toastStore'

const LARGE_FILE_THRESHOLD = 1 * 1024 * 1024 // 1MB

export interface OpenFile {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

interface EditorState {
  editorMode: boolean
  openFiles: OpenFile[]
  activeFilePath: string | null
  currentBranch: string | null
  /** When set, shows a large-file confirmation dialog before opening */
  pendingLargeFile: { path: string; size: number } | null

  setEditorMode: (active: boolean) => void
  openFile: (filePath: string, repoPath: string) => Promise<void>
  /** Force-open a file regardless of size (after user confirms large-file warning) */
  forceOpenFile: (filePath: string, repoPath: string) => Promise<void>
  dismissLargeFile: () => void
  closeFile: (filePath: string) => Promise<void>
  setActiveFile: (filePath: string) => void
  updateFileContent: (filePath: string, content: string) => void
  saveFile: (filePath: string, repoPath: string) => Promise<void>
  saveActiveFile: (repoPath: string) => Promise<void>
  createNewFile: (filePath: string, repoPath: string) => Promise<void>
  loadBranch: (repoPath: string) => Promise<void>
  handleExternalChange: (filePath: string, repoPath: string) => Promise<void>
}

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript-jsx',
    js: 'javascript', jsx: 'javascript-jsx',
    css: 'css', json: 'json', md: 'markdown',
    py: 'python', html: 'html', htm: 'html',
    yml: 'yaml', yaml: 'yaml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    rs: 'rust', go: 'go', java: 'java',
    toml: 'toml', xml: 'xml', svg: 'xml',
  }
  return map[ext] ?? 'text'
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

export const useEditorStore = create<EditorState>((set, get) => ({
  editorMode: false,
  openFiles: [],
  activeFilePath: null,
  currentBranch: null,
  pendingLargeFile: null,

  setEditorMode: (active) => {
    set({ editorMode: active })
  },

  openFile: async (filePath, repoPath) => {
    const { addToast } = useToastStore.getState()

    // If already open, just activate
    const existing = get().openFiles.find((f) => f.path === filePath)
    if (existing) {
      set({ activeFilePath: filePath })
      return
    }

    try {
      // Check file size first
      const stat = await window.api.file.stat(filePath)
      if (!stat.exists) {
        addToast('error', `File not found: ${filePath}`)
        return
      }
      if (stat.size > LARGE_FILE_THRESHOLD) {
        set({ pendingLargeFile: { path: filePath, size: stat.size } })
        return
      }

      await get().forceOpenFile(filePath, repoPath)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  forceOpenFile: async (filePath, repoPath) => {
    const { addToast } = useToastStore.getState()

    // If already open, just activate
    const existing = get().openFiles.find((f) => f.path === filePath)
    if (existing) {
      set({ activeFilePath: filePath, pendingLargeFile: null })
      return
    }

    try {
      const content = await window.api.file.read(filePath, repoPath)
      const file: OpenFile = {
        path: filePath,
        name: getFileName(filePath),
        content,
        savedContent: content,
        language: getLanguage(filePath),
      }
      set((s) => ({
        openFiles: [...s.openFiles, file],
        activeFilePath: filePath,
        pendingLargeFile: null,
      }))
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
      set({ pendingLargeFile: null })
    }
  },

  dismissLargeFile: () => {
    set({ pendingLargeFile: null })
  },

  closeFile: async (filePath) => {
    const file = get().openFiles.find((f) => f.path === filePath)
    if (!file) return

    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== filePath)
      let activeFilePath = s.activeFilePath
      if (activeFilePath === filePath) {
        // Activate the next or previous tab
        const idx = s.openFiles.findIndex((f) => f.path === filePath)
        activeFilePath = remaining[Math.min(idx, remaining.length - 1)]?.path ?? null
      }
      return { openFiles: remaining, activeFilePath }
    })
  },

  setActiveFile: (filePath) => {
    set({ activeFilePath: filePath })
  },

  updateFileContent: (filePath, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === filePath ? { ...f, content } : f
      ),
    }))
  },

  saveFile: async (filePath, repoPath) => {
    const { addToast } = useToastStore.getState()
    const file = get().openFiles.find((f) => f.path === filePath)
    if (!file || file.content === file.savedContent) return

    try {
      await window.api.file.write(filePath, file.content, repoPath)
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === filePath ? { ...f, savedContent: f.content } : f
        ),
      }))
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  saveActiveFile: async (repoPath) => {
    const { activeFilePath } = get()
    if (activeFilePath) {
      await get().saveFile(activeFilePath, repoPath)
    }
  },

  createNewFile: async (filePath, repoPath) => {
    const { addToast } = useToastStore.getState()
    try {
      await window.api.file.create(filePath, repoPath)
      await get().forceOpenFile(filePath, repoPath)
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  loadBranch: async (repoPath) => {
    try {
      const status = await window.api.git.status(repoPath)
      set({ currentBranch: status.current ?? null })
    } catch {
      set({ currentBranch: null })
    }
  },

  handleExternalChange: async (filePath, repoPath) => {
    const file = get().openFiles.find((f) => f.path === filePath)
    if (!file) return

    // If file is dirty, don't auto-reload (user might lose changes)
    if (file.content !== file.savedContent) return

    try {
      const content = await window.api.file.read(filePath, repoPath)
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === filePath ? { ...f, content, savedContent: content } : f
        ),
      }))
    } catch {
      // File may have been deleted
    }
  },
}))

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { marked } from 'marked'
import { useEditorStore, type OpenFile } from '../../stores/editorStore'
import { getLanguageExtension } from './languageMap'
import { createEditorTheme } from './codemirrorTheme'
import { isImageFile } from '../git/ImageDiffViewer'

function isMarkdownFile(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path)
}

interface CodeEditorPanelProps {
  repoPath: string
}

export function CodeEditorPanel({ repoPath }: CodeEditorPanelProps) {
  const { openFiles, activeFilePath, setActiveFile, closeFile, saveFile, saveActiveFile, updateFileContent } = useEditorStore()
  const activeFile = openFiles.find((f) => f.path === activeFilePath)
  const [markdownPreview, setMarkdownPreview] = useState(false)
  const showMarkdownToggle = activeFile && isMarkdownFile(activeFile.path) && !isImageFile(activeFile.path)

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* File tabs */}
      {openFiles.length > 0 && (
        <FileTabs
          files={openFiles}
          activeFilePath={activeFilePath}
          onSelect={setActiveFile}
          onClose={(path) => {
            // Auto-save before closing
            const file = openFiles.find((f) => f.path === path)
            if (file && file.content !== file.savedContent) {
              saveFile(path, repoPath)
            }
            closeFile(path)
          }}
          trailingAction={showMarkdownToggle ? (
            <button
              onClick={() => setMarkdownPreview((v) => !v)}
              className={`flex items-center justify-center rounded transition-colors flex-shrink-0
                ${markdownPreview ? 'text-accent bg-accent/15' : 'text-text-muted hover:text-text'}`}
              style={{ width: 28, height: 28, marginRight: 4 }}
              title={markdownPreview ? 'Hide markdown preview' : 'Preview markdown'}
              aria-label="Toggle markdown preview"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          ) : undefined}
        />
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0">
        {activeFile && isImageFile(activeFile.path) ? (
          <ImagePreview filePath={activeFile.path} repoPath={repoPath} />
        ) : activeFile ? (
          <div className="flex h-full min-h-0">
            <div className={markdownPreview && showMarkdownToggle ? 'w-1/2 min-h-0 border-r border-border' : 'w-full min-h-0'}>
              <CodeMirrorEditor
                file={activeFile}
                repoPath={repoPath}
                onContentChange={updateFileContent}
                onSave={saveActiveFile}
              />
            </div>
            {markdownPreview && showMarkdownToggle && (
              <div className="w-1/2 min-h-0 overflow-auto" style={{ padding: '16px' }}>
                <MarkdownPreview content={activeFile.content} />
              </div>
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-text-muted text-xs">
            Select a file to edit
          </div>
        )}
      </div>
    </div>
  )
}

/* ── File Tabs ────────────────────────────────────────── */

function FileTabs({
  files,
  activeFilePath,
  onSelect,
  onClose,
  trailingAction,
}: {
  files: OpenFile[]
  activeFilePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
  trailingAction?: React.ReactNode
}) {
  return (
    <div
      className="flex items-center bg-bg-tertiary border-b border-border"
      style={{ padding: '0 4px' }}
      role="tablist"
    >
      <div className="flex items-center overflow-x-auto flex-1 min-w-0">
      {files.map((file) => {
        const isActive = file.path === activeFilePath
        const isDirty = file.content !== file.savedContent
        return (
          <button
            key={file.path}
            role="tab"
            aria-selected={isActive}
            className={`flex items-center gap-1.5 text-xs transition-colors relative group flex-shrink-0
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset
              ${isActive ? 'text-text' : 'text-text-muted hover:text-text'}`}
            style={{ padding: '8px 10px' }}
            onClick={() => onSelect(file.path)}
            onAuxClick={(e) => {
              if (e.button === 1) onClose(file.path)
            }}
          >
            <span className="truncate" style={{ maxWidth: 140 }}>{file.name}</span>
            {isDirty && (
              <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            )}
            <span
              onClick={(e) => {
                e.stopPropagation()
                onClose(file.path)
              }}
              className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-danger transition-opacity rounded"
              role="button"
              aria-label={`Close ${file.name}`}
              tabIndex={-1}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
            {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />}
          </button>
        )
      })}
      </div>
      {trailingAction}
    </div>
  )
}

/* ── CodeMirror Editor ────────────────────────────────── */

function CodeMirrorEditor({
  file,
  repoPath,
  onContentChange,
  onSave,
}: {
  file: OpenFile
  repoPath: string
  onContentChange: (path: string, content: string) => void
  onSave: (repoPath: string) => Promise<void>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const stateCache = useRef<Map<string, { state: EditorState; scrollTop: number }>>(new Map())
  const currentPathRef = useRef<string | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)

  // Watch for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme') {
          setThemeVersion((v) => v + 1)
        }
      }
    })
    observer.observe(document.documentElement, { attributes: true })
    return () => observer.disconnect()
  }, [])

  // Create or update editor view
  useEffect(() => {
    if (!containerRef.current) return

    const filePath = file.path

    // Save current state before switching
    if (viewRef.current && currentPathRef.current && currentPathRef.current !== filePath) {
      const prevPath = currentPathRef.current
      // Auto-save on switch
      const prevFile = useEditorStore.getState().openFiles.find((f) => f.path === prevPath)
      if (prevFile && prevFile.content !== prevFile.savedContent) {
        useEditorStore.getState().saveFile(prevPath, repoPath)
      }
      stateCache.current.set(prevPath, {
        state: viewRef.current.state,
        scrollTop: viewRef.current.scrollDOM.scrollTop,
      })
    }

    const theme = createEditorTheme()

    const saveKeymap = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSave(repoPath)
          return true
        },
      },
    ])

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onContentChange(filePath, update.state.doc.toString())
      }
    })

    // Check if we have a cached state
    const cached = stateCache.current.get(filePath)

    const createState = async () => {
      const langExt = await getLanguageExtension(filePath)
      const extensions = [
        saveKeymap,
        lineNumbers(),
        history(),
        drawSelection(),
        bracketMatching(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        theme,
        updateListener,
        EditorView.lineWrapping,
      ]
      if (langExt) extensions.push(langExt)

      if (cached) {
        // Reconfigure the cached state with new extensions (to get fresh theme)
        const newState = EditorState.create({
          doc: cached.state.doc,
          selection: cached.state.selection,
          extensions,
        })

        if (viewRef.current) {
          viewRef.current.setState(newState)
          requestAnimationFrame(() => {
            viewRef.current?.scrollDOM.scrollTo(0, cached.scrollTop)
          })
        } else {
          const view = new EditorView({
            state: newState,
            parent: containerRef.current!,
          })
          viewRef.current = view
          requestAnimationFrame(() => {
            view.scrollDOM.scrollTo(0, cached.scrollTop)
          })
        }
      } else {
        const state = EditorState.create({
          doc: file.content,
          extensions,
        })

        if (viewRef.current) {
          viewRef.current.setState(state)
        } else {
          viewRef.current = new EditorView({
            state,
            parent: containerRef.current!,
          })
        }
      }

      currentPathRef.current = filePath
    }

    createState()

    // Cleanup on unmount
    return () => {
      // Don't destroy the view on re-render, only on true unmount
    }
  }, [file.path, themeVersion])

  // Cleanup view on unmount
  useEffect(() => {
    return () => {
      if (viewRef.current) {
        // Save final state
        if (currentPathRef.current) {
          stateCache.current.set(currentPathRef.current, {
            state: viewRef.current.state,
            scrollTop: viewRef.current.scrollDOM.scrollTop,
          })
        }
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [])

  return <div ref={containerRef} className="h-full" />
}

/* ── Image Preview ────────────────────────────────────── */

function ImagePreview({ filePath, repoPath }: { filePath: string; repoPath: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setError(false)

    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
    }
    const mime = mimeMap[ext] || 'image/png'

    window.api.file.readBase64(filePath, repoPath)
      .then((data) => {
        if (!cancelled) setSrc(`data:${mime};base64,${data}`)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => { cancelled = true }
  }, [filePath, repoPath])

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-xs">
        Unable to load image
      </div>
    )
  }

  if (!src) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-xs">
        Loading image...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col items-center justify-center overflow-auto bg-bg" style={{ padding: '16px' }}>
      <img
        src={src}
        alt={filePath.split('/').pop() || 'Image'}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        draggable={false}
      />
    </div>
  )
}

/* ── Markdown Preview ────────────────────────────────── */

function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content) as string, [content])
  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

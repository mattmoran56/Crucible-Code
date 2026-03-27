import React from 'react'
import { FileExplorer } from './FileExplorer'
import { CodeEditorPanel } from './CodeEditorPanel'
import { ResizeHandle } from '../ui/ResizeHandle'
import { useResizable } from '../../hooks/useResizable'
import { useEditorStore } from '../../stores/editorStore'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'

interface EditorPanelProps {
  repoPath: string
}

export function EditorPanel({ repoPath }: EditorPanelProps) {
  const fileTree = useResizable({
    direction: 'horizontal',
    initialSize: 240,
    minSize: 160,
    maxSize: 400,
  })

  const { pendingLargeFile, forceOpenFile, dismissLargeFile } = useEditorStore()

  return (
    <div className="flex h-full min-h-0">
      {/* File tree */}
      <div style={{ width: fileTree.size }} className="flex-shrink-0">
        <FileExplorer repoPath={repoPath} />
      </div>
      <ResizeHandle direction="horizontal" onMouseDown={fileTree.onMouseDown} />

      {/* Code editor */}
      <div className="flex-1 min-w-0">
        <CodeEditorPanel repoPath={repoPath} />
      </div>

      {/* Large file warning dialog */}
      <Dialog
        open={pendingLargeFile != null}
        onClose={dismissLargeFile}
        title="Large File"
      >
        <p className="text-text text-xs" style={{ marginBottom: 12 }}>
          This file is{' '}
          <strong>
            {pendingLargeFile
              ? `${(pendingLargeFile.size / 1024 / 1024).toFixed(1)}MB`
              : ''}
          </strong>
          . Opening large files may slow down the editor.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={dismissLargeFile}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (pendingLargeFile) {
                forceOpenFile(pendingLargeFile.path, repoPath)
              }
            }}
          >
            Open Anyway
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

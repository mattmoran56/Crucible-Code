import React from 'react'
import { useGitStore } from '../../stores/gitStore'

interface Props {
  repoPath: string
}

const STATUS_COLORS: Record<string, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-accent',
}

const STATUS_LABELS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}

export function ChangedFiles({ repoPath }: Props) {
  const { changedFiles, selectedCommitHash, selectedFilePath, selectFile } = useGitStore()

  if (!selectedCommitHash) {
    return <div className="p-3 text-text-muted text-xs">Select a commit</div>
  }

  if (changedFiles.length === 0) {
    return <div className="p-3 text-text-muted text-xs">No changes in this commit</div>
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {changedFiles.map((file) => (
        <button
          key={file.filePath}
          onClick={() => selectFile(repoPath, selectedCommitHash, file.filePath)}
          className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
            file.filePath === selectedFilePath
              ? 'bg-accent/10 text-accent'
              : 'hover:bg-bg-tertiary'
          }`}
        >
          <span className={`font-mono font-bold ${STATUS_COLORS[file.status] || ''}`}>
            {STATUS_LABELS[file.status] || '?'}
          </span>
          <span className="truncate">{file.filePath}</span>
          {(file.insertions > 0 || file.deletions > 0) && (
            <span className="ml-auto flex gap-1 text-[10px]">
              {file.insertions > 0 && <span className="text-success">+{file.insertions}</span>}
              {file.deletions > 0 && <span className="text-danger">-{file.deletions}</span>}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

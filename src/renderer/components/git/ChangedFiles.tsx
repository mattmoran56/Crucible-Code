import React from 'react'
import { useGitStore } from '../../stores/gitStore'
import { ListBox, ListItem } from '../ui/ListBox'

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
    <ListBox
      label="Changed files"
      className="flex-1 overflow-y-auto"
      onSelect={(index) =>
        selectFile(repoPath, selectedCommitHash, changedFiles[index].filePath)
      }
    >
      {changedFiles.map((file) => (
        <ListItem
          key={file.filePath}
          selected={file.filePath === selectedFilePath}
          onClick={() => selectFile(repoPath, selectedCommitHash, file.filePath)}
          className="text-xs flex items-center gap-2"
          style={{ padding: '6px 12px' }}
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
        </ListItem>
      ))}
    </ListBox>
  )
}

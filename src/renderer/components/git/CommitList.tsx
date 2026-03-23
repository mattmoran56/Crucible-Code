import React from 'react'
import { useGitStore } from '../../stores/gitStore'
import { ListBox, ListItem } from '../ui/ListBox'

interface Props {
  repoPath: string
}

export function CommitList({ repoPath }: Props) {
  const { commits, selectedCommitHash, selectCommit, loading } = useGitStore()

  if (loading) {
    return <div className="p-3 text-text-muted text-xs">Loading commits...</div>
  }

  if (commits.length === 0) {
    return <div className="p-3 text-text-muted text-xs">No commits yet</div>
  }

  return (
    <ListBox
      label="Commits"
      className="flex-1 overflow-y-auto"
      onSelect={(index) => selectCommit(repoPath, commits[index].hash)}
    >
      {commits.map((commit) => (
        <ListItem
          key={commit.hash}
          selected={commit.hash === selectedCommitHash}
          onClick={() => selectCommit(repoPath, commit.hash)}
          className="border-b border-border text-xs"
          style={{ padding: '8px 12px' }}
        >
          <div className="font-medium truncate">{commit.message}</div>
          <div className="flex gap-2 mt-1 text-text-muted text-[10px]">
            <span className="font-mono">{commit.hash.slice(0, 7)}</span>
            <span>{commit.author}</span>
            <span>{new Date(commit.date).toLocaleDateString()}</span>
          </div>
        </ListItem>
      ))}
    </ListBox>
  )
}

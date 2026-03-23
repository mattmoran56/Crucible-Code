import React from 'react'
import { useGitStore } from '../../stores/gitStore'

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
    <div className="flex-1 overflow-y-auto">
      {commits.map((commit) => (
        <button
          key={commit.hash}
          onClick={() => selectCommit(repoPath, commit.hash)}
          className={`w-full text-left px-3 py-2 border-b border-border text-xs transition-colors ${
            commit.hash === selectedCommitHash
              ? 'bg-accent/10 text-accent'
              : 'hover:bg-bg-tertiary'
          }`}
        >
          <div className="font-medium truncate">{commit.message}</div>
          <div className="flex gap-2 mt-0.5 text-text-muted text-[10px]">
            <span className="font-mono">{commit.hash.slice(0, 7)}</span>
            <span>{commit.author}</span>
            <span>{new Date(commit.date).toLocaleDateString()}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

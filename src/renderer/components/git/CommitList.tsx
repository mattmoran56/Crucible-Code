import React from 'react'
import { useGitStore, WORKING_CHANGES_HASH } from '../../stores/gitStore'
import { ListBox, ListItem } from '../ui/ListBox'

interface Props {
  repoPath: string
}

export function CommitList({ repoPath }: Props) {
  const { commits, selectedCommitHash, selectCommit, loading, workingFiles, commitStatuses } = useGitStore()

  const unpushedSet = new Set(commitStatuses.unpushedHashes)
  const newBranchSet = new Set(commitStatuses.newBranchHashes)

  if (loading && commits.length === 0) {
    return <div className="p-3 text-text-muted text-xs">Loading commits...</div>
  }

  return (
    <ListBox
      label="Commits"
      className="flex-1 overflow-y-auto"
      onSelect={(index) => {
        // index 0 is always the WORKING_CHANGES entry
        if (index === 0) {
          selectCommit(repoPath, WORKING_CHANGES_HASH)
        } else {
          selectCommit(repoPath, commits[index - 1].hash)
        }
      }}
    >
      {/* Uncommitted changes pseudo-commit */}
      <ListItem
        key={WORKING_CHANGES_HASH}
        selected={selectedCommitHash === WORKING_CHANGES_HASH}
        onClick={() => selectCommit(repoPath, WORKING_CHANGES_HASH)}
        className="border-b border-border text-xs"
        style={{ padding: '8px 12px' }}
      >
        <div className="flex items-center justify-between">
          <span className={workingFiles.length > 0 ? 'text-warning font-medium' : 'text-text-muted font-medium'}>
            Uncommitted Changes
          </span>
          {workingFiles.length > 0 && (
            <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full font-mono">
              {workingFiles.length}
            </span>
          )}
        </div>
        <div className="text-text-muted text-[10px] mt-1">
          {workingFiles.length === 0
            ? 'No changes'
            : `${workingFiles.length} file${workingFiles.length !== 1 ? 's' : ''} modified`}
        </div>
      </ListItem>

      {commits.length === 0 ? (
        <div className="p-3 text-text-muted text-xs">No commits yet</div>
      ) : (
        commits.map((commit) => (
          <ListItem
            key={commit.hash}
            selected={commit.hash === selectedCommitHash}
            onClick={() => selectCommit(repoPath, commit.hash)}
            className="border-b border-border text-xs"
            style={{ padding: '8px 12px' }}
          >
            <div className="flex items-start gap-1">
              <div className="font-medium truncate flex-1 min-w-0">{commit.message}</div>
              {(unpushedSet.has(commit.hash) || newBranchSet.has(commit.hash)) && (
                <div className="flex items-center gap-0.5 shrink-0 mt-px">
                  {unpushedSet.has(commit.hash) && (
                    <span title="Not pushed to remote" className="text-text-muted text-[11px] leading-none">↑</span>
                  )}
                  {newBranchSet.has(commit.hash) && (
                    <span title="New commit (not on base branch)" className="text-accent text-[9px] leading-none">◆</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-1 text-text-muted text-[10px]">
              <span className="font-mono">{commit.hash.slice(0, 7)}</span>
              <span>{commit.author}</span>
              <span>{new Date(commit.date).toLocaleDateString()}</span>
            </div>
          </ListItem>
        ))
      )}
    </ListBox>
  )
}

import React, { useCallback } from 'react'
import { useGitStore, WORKING_CHANGES_HASH } from '../../stores/gitStore'
import { useToastStore } from '../../stores/toastStore'
import { ListBox, ListItem } from '../ui/ListBox'
import { useContextMenu, type ContextMenuItem } from '../ui/ContextMenu'
import type { FileDiff } from '../../../shared/types'

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
  const { changedFiles, selectedCommitHash, selectedFilePath, selectFile, loadWorkingFiles } = useGitStore()
  const { onContextMenu, menu } = useContextMenu()

  const isWorking = selectedCommitHash === WORKING_CHANGES_HASH

  const buildItems = useCallback(
    (file: FileDiff): ContextMenuItem[] => {
      const { addToast } = useToastStore.getState()
      const refresh = () => loadWorkingFiles(repoPath)
      const items: ContextMenuItem[] = [
        {
          label: 'Open',
          onClick: () =>
            selectFile(repoPath, selectedCommitHash || WORKING_CHANGES_HASH, file.filePath),
        },
        {
          label: 'Reveal in Finder',
          onClick: () => window.api.git.revealFile(`${repoPath}/${file.filePath}`),
        },
        {
          label: 'Copy path',
          onClick: () => navigator.clipboard.writeText(file.filePath),
          separatorAfter: isWorking,
        },
      ]
      if (isWorking) {
        items.push(
          {
            label: 'Stage file',
            onClick: async () => {
              try {
                await window.api.git.stageFile(repoPath, file.filePath)
                await refresh()
              } catch (err) {
                addToast('error', err instanceof Error ? err.message : String(err))
              }
            },
          },
          {
            label: 'Unstage file',
            onClick: async () => {
              try {
                await window.api.git.unstageFile(repoPath, file.filePath)
                await refresh()
              } catch (err) {
                addToast('error', err instanceof Error ? err.message : String(err))
              }
            },
          },
          {
            label: 'Stash this file',
            onClick: async () => {
              try {
                await window.api.git.stashFile(repoPath, file.filePath)
                await refresh()
                addToast('success', `Stashed ${file.filePath}`)
              } catch (err) {
                addToast('error', err instanceof Error ? err.message : String(err))
              }
            },
            separatorAfter: true,
          },
          {
            label: 'Discard changes',
            variant: 'danger',
            onClick: async () => {
              if (!confirm(`Discard changes to ${file.filePath}? This cannot be undone.`)) return
              try {
                await window.api.git.discardFile(repoPath, file.filePath)
                await refresh()
              } catch (err) {
                addToast('error', err instanceof Error ? err.message : String(err))
              }
            },
          }
        )
      }
      return items
    },
    [repoPath, selectedCommitHash, isWorking, selectFile, loadWorkingFiles]
  )

  if (!selectedCommitHash) {
    return <div className="p-3 text-text-muted text-xs">Select a commit</div>
  }

  if (changedFiles.length === 0) {
    return <div className="p-3 text-text-muted text-xs">No changes in this commit</div>
  }

  return (
    <>
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
            onContextMenu={(e) => onContextMenu(e, buildItems(file))}
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
      {menu}
    </>
  )
}

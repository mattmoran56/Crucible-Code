import React, { useCallback, useEffect, useMemo, useState } from 'react'
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

  // Multi-select state — only meaningful for the working-changes pseudo-commit.
  // `extra` holds additionally-selected file paths (active selection is
  // selectedFilePath in the store). `anchor` is the pivot for shift-range.
  const [extra, setExtra] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  // Reset multi-select when leaving working changes or when file list changes
  // such that selected paths no longer exist.
  useEffect(() => {
    if (!isWorking) {
      if (extra.size > 0) setExtra(new Set())
      if (anchor !== null) setAnchor(null)
      return
    }
    const present = new Set(changedFiles.map((f) => f.filePath))
    let changed = false
    const next = new Set<string>()
    for (const p of extra) {
      if (present.has(p)) next.add(p)
      else changed = true
    }
    if (changed) setExtra(next)
    if (anchor && !present.has(anchor)) setAnchor(null)
  }, [isWorking, changedFiles, extra, anchor])

  const selectedSet = useMemo(() => {
    const s = new Set(extra)
    if (selectedFilePath) s.add(selectedFilePath)
    return s
  }, [extra, selectedFilePath])

  const handleClick = useCallback(
    (e: React.MouseEvent, file: FileDiff) => {
      if (!selectedCommitHash) return
      if (!isWorking) {
        // Single-select for non-working commits
        selectFile(repoPath, selectedCommitHash, file.filePath)
        return
      }
      const cmd = e.metaKey || e.ctrlKey
      const shift = e.shiftKey
      if (shift && (anchor || selectedFilePath)) {
        const start = anchor ?? selectedFilePath!
        const startIdx = changedFiles.findIndex((f) => f.filePath === start)
        const endIdx = changedFiles.findIndex((f) => f.filePath === file.filePath)
        if (startIdx === -1 || endIdx === -1) {
          selectFile(repoPath, selectedCommitHash, file.filePath)
          setExtra(new Set())
          setAnchor(file.filePath)
          return
        }
        const [lo, hi] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const next = new Set<string>()
        for (let i = lo; i <= hi; i++) next.add(changedFiles[i].filePath)
        next.delete(file.filePath) // active path lives in selectedFilePath
        setExtra(next)
        selectFile(repoPath, selectedCommitHash, file.filePath)
        return
      }
      if (cmd) {
        // Toggle this file in the selection.
        const isCurrentlySelected = selectedSet.has(file.filePath)
        if (isCurrentlySelected) {
          // Deselect — but keep at least one file as the active diff target.
          if (file.filePath === selectedFilePath) {
            // Promote one of `extra` to active (or clear if none).
            const promoted = extra.values().next().value as string | undefined
            if (promoted) {
              const nextExtra = new Set(extra)
              nextExtra.delete(promoted)
              setExtra(nextExtra)
              selectFile(repoPath, selectedCommitHash, promoted)
            } else {
              // Nothing else selected — leave the click as a no-op.
            }
          } else {
            const nextExtra = new Set(extra)
            nextExtra.delete(file.filePath)
            setExtra(nextExtra)
          }
        } else {
          // Add to selection. Make this the active diff target and push the
          // previously-active path into `extra`.
          const nextExtra = new Set(extra)
          if (selectedFilePath && selectedFilePath !== file.filePath) nextExtra.add(selectedFilePath)
          nextExtra.delete(file.filePath)
          setExtra(nextExtra)
          selectFile(repoPath, selectedCommitHash, file.filePath)
        }
        setAnchor(file.filePath)
        return
      }
      // Plain click — single select
      setExtra(new Set())
      setAnchor(file.filePath)
      selectFile(repoPath, selectedCommitHash, file.filePath)
    },
    [repoPath, isWorking, selectedCommitHash, selectedFilePath, anchor, changedFiles, extra, selectedSet, selectFile]
  )

  const buildItems = useCallback(
    (file: FileDiff): ContextMenuItem[] => {
      const { addToast } = useToastStore.getState()
      const refresh = () => loadWorkingFiles(repoPath)

      // If the right-clicked file is part of the multi-selection, target all
      // selected files; otherwise treat the click as a single-file action and
      // make sure the click target becomes the active selection.
      const targets = isWorking && selectedSet.has(file.filePath)
        ? Array.from(selectedSet)
        : [file.filePath]

      const isMulti = targets.length > 1
      const suffix = isMulti ? ` (${targets.length} files)` : ''

      const runAll = async (
        action: (path: string) => Promise<void>,
        successMsg?: (n: number) => string
      ) => {
        const errors: string[] = []
        for (const path of targets) {
          try {
            await action(path)
          } catch (err) {
            errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        await refresh()
        if (errors.length > 0) addToast('error', errors.join('\n'))
        else if (successMsg) addToast('success', successMsg(targets.length))
      }

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
          label: isMulti ? `Copy ${targets.length} paths` : 'Copy path',
          onClick: () => navigator.clipboard.writeText(targets.join('\n')),
          separatorAfter: isWorking,
        },
      ]
      if (isWorking) {
        items.push(
          {
            label: `Stage file${suffix}`,
            onClick: () => runAll((p) => window.api.git.stageFile(repoPath, p)),
          },
          {
            label: `Unstage file${suffix}`,
            onClick: () => runAll((p) => window.api.git.unstageFile(repoPath, p)),
          },
          {
            label: `Stash this file${suffix}`,
            onClick: () =>
              runAll(
                (p) => window.api.git.stashFile(repoPath, p),
                (n) => (n === 1 ? `Stashed ${targets[0]}` : `Stashed ${n} files`)
              ),
            separatorAfter: true,
          },
          {
            label: `Discard changes${suffix}`,
            variant: 'danger',
            onClick: () => {
              const msg = isMulti
                ? `Discard changes to ${targets.length} files? This cannot be undone.`
                : `Discard changes to ${targets[0]}? This cannot be undone.`
              if (!confirm(msg)) return
              runAll((p) => window.api.git.discardFile(repoPath, p))
            },
          }
        )
      }
      return items
    },
    [repoPath, selectedCommitHash, isWorking, selectedSet, selectFile, loadWorkingFiles]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: FileDiff) => {
      // If right-clicking a file outside the current selection, replace the
      // selection with just that file before opening the menu.
      if (isWorking && !selectedSet.has(file.filePath) && selectedCommitHash) {
        setExtra(new Set())
        setAnchor(file.filePath)
        selectFile(repoPath, selectedCommitHash, file.filePath)
      }
      onContextMenu(e, buildItems(file))
    },
    [isWorking, selectedSet, selectedCommitHash, repoPath, selectFile, onContextMenu, buildItems]
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
        {changedFiles.map((file) => {
          const inSelection = selectedSet.has(file.filePath)
          const isActive = file.filePath === selectedFilePath
          return (
            <ListItem
              key={file.filePath}
              selected={isActive}
              onClick={(e) => handleClick(e, file)}
              onContextMenu={(e) => handleContextMenu(e, file)}
              className={`text-xs flex items-center gap-2 ${
                inSelection && !isActive ? 'bg-accent/5 text-text' : ''
              }`}
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
          )
        })}
      </ListBox>
      {menu}
    </>
  )
}

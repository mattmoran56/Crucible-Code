import { useCallback, useEffect, useRef, useState } from 'react'
import { WORKING_CHANGES_HASH } from '../../stores/gitStore'
import type { ExpanderMeta } from './DiffViewer'

interface UseExpandableBlobInput {
  repoPath: string | null
  filePath: string | null
  /** Commit being viewed, or WORKING_CHANGES_HASH when looking at uncommitted changes. */
  commitHash: string | null
}

interface UseExpandableBlobResult {
  blobLines: string[] | null
  expandedNewLines: Set<number>
  handleExpand: (direction: 'up' | 'down' | 'all', meta: ExpanderMeta) => Promise<void>
}

const STEP = 20

/**
 * Fetches the post-change file contents on demand so that "Show N unchanged
 * lines" can splice real context into a diff hunk. The blob is fetched the
 * first time the user clicks expand — keeping the working tree / git show
 * call off the hot path for viewers that never expand.
 */
export function useExpandableBlob({
  repoPath,
  filePath,
  commitHash,
}: UseExpandableBlobInput): UseExpandableBlobResult {
  const [blobLines, setBlobLines] = useState<string[] | null>(null)
  const [expandedNewLines, setExpandedNewLines] = useState<Set<number>>(new Set())
  const fetchPromiseRef = useRef<Promise<string[] | null> | null>(null)
  const cacheKeyRef = useRef<string | null>(null)

  // Reset state when the selected file changes — the blob is per-file.
  useEffect(() => {
    const key = repoPath && filePath && commitHash ? `${commitHash}:${filePath}` : null
    if (cacheKeyRef.current !== key) {
      cacheKeyRef.current = key
      setBlobLines(null)
      setExpandedNewLines(new Set())
      fetchPromiseRef.current = null
    }
  }, [repoPath, filePath, commitHash])

  const ensureBlob = useCallback(async (): Promise<string[] | null> => {
    if (blobLines) return blobLines
    if (!repoPath || !filePath || !commitHash) return null

    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = (async () => {
        try {
          let raw: string | null = null
          if (commitHash === WORKING_CHANGES_HASH) {
            // Working changes — read the file directly from the worktree.
            raw = await window.api.file.read(filePath, repoPath)
          } else {
            raw = await window.api.git.showFile(repoPath, commitHash, filePath)
          }
          if (raw == null) return null
          const lines = raw.split('\n')
          // Trim trailing newline that `split('\n')` produces for files that
          // end with `\n` — otherwise we'd offer an off-by-one bonus blank line.
          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
          return lines
        } catch {
          return null
        }
      })()
    }

    const lines = await fetchPromiseRef.current
    if (lines) setBlobLines(lines)
    return lines
  }, [blobLines, repoPath, filePath, commitHash])

  const handleExpand = useCallback(
    async (direction: 'up' | 'down' | 'all', meta: ExpanderMeta) => {
      const blob = await ensureBlob()
      if (!blob) return

      const hasUpper = meta.nextNewStart != null && !meta.isTail
      const upper = hasUpper
        ? meta.nextNewStart! - 1
        : meta.isTail
          ? blob.length
          : meta.prevNewEnd

      let from: number, to: number
      if (direction === 'up' && hasUpper) {
        to = upper
        from = Math.max(meta.prevNewEnd + 1, upper - STEP + 1)
      } else if (direction === 'all' && hasUpper) {
        from = meta.prevNewEnd + 1
        to = upper
      } else {
        from = meta.prevNewEnd + 1
        to = Math.min(upper, meta.prevNewEnd + STEP)
      }
      if (to < from) return

      setExpandedNewLines((prev) => {
        const next = new Set(prev)
        for (let n = from; n <= to; n++) next.add(n)
        return next
      })
    },
    [ensureBlob]
  )

  return { blobLines, expandedNewLines, handleExpand }
}

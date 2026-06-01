// Pure helpers for parsing unified diffs. Kept free of React, shiki, and
// stores so they can be re-used by the PWA receiver, which only needs the
// data model — not the full DiffViewer UI.

export interface ExpanderMeta {
  prevOldEnd: number
  prevNewEnd: number
  nextOldStart: number | null
  nextNewStart: number | null
  /** True if this expander is positioned after the last hunk (file may extend further). */
  isTail?: boolean
}

export interface DiffLine {
  type: 'header' | 'context' | 'add' | 'delete' | 'hunk' | 'expander'
  content: string
  oldLine?: number
  newLine?: number
  /** Sequential id of the hunk this line belongs to (hunk row included). */
  hunkId?: number
  /** Set on `expander` rows. */
  expander?: ExpanderMeta
}

export function parsePatch(patch: string): DiffLine[] {
  const sourceLines = patch.split('\n')
  const result: DiffLine[] = []

  let oldLine = 0
  let newLine = 0
  let inDiff = false
  let hunkId = -1

  let lastOldEnd = 0
  let lastNewEnd = 0
  let lastHadHunk = false

  for (const line of sourceLines) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      const oldStart = match ? parseInt(match[1], 10) : 0
      const oldCount = match ? parseInt(match[2] ?? '1', 10) : 0
      const newStart = match ? parseInt(match[3], 10) : 0
      const newCount = match ? parseInt(match[4] ?? '1', 10) : 0

      const prevOldEnd = lastHadHunk ? lastOldEnd : 0
      const prevNewEnd = lastHadHunk ? lastNewEnd : 0
      const gap = newStart - 1 - prevNewEnd
      if (gap > 0) {
        result.push({
          type: 'expander',
          content: '',
          expander: {
            prevOldEnd,
            prevNewEnd,
            nextOldStart: oldStart,
            nextNewStart: newStart,
          },
        })
      }

      hunkId += 1
      inDiff = true
      oldLine = oldStart
      newLine = newStart
      lastOldEnd = oldStart + Math.max(oldCount, 1) - 1
      lastNewEnd = newStart + Math.max(newCount, 1) - 1
      lastHadHunk = true

      result.push({ type: 'hunk', content: line, hunkId })
    } else if (!inDiff) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLine: newLine++, hunkId })
    } else if (line.startsWith('-')) {
      result.push({ type: 'delete', content: line.slice(1), oldLine: oldLine++, hunkId })
    } else {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLine: oldLine++,
        newLine: newLine++,
        hunkId,
      })
    }
  }

  if (lastHadHunk) {
    result.push({
      type: 'expander',
      content: '',
      expander: {
        prevOldEnd: lastOldEnd,
        prevNewEnd: lastNewEnd,
        nextOldStart: null,
        nextNewStart: null,
        isTail: true,
      },
    })
  }

  return result
}

export interface DisplayOptions {
  expandedNewLines: Set<number> | undefined
  blobLines: string[] | null
  collapsedHunks: Set<number>
}

export function buildDisplayLines(parsed: DiffLine[], opts: DisplayOptions): DiffLine[] {
  const out: DiffLine[] = []
  const { expandedNewLines, blobLines, collapsedHunks } = opts

  for (const line of parsed) {
    if (line.type === 'expander' && line.expander) {
      const { prevOldEnd, prevNewEnd, nextNewStart, isTail } = line.expander
      const upperBound = isTail
        ? blobLines?.length ?? prevNewEnd
        : (nextNewStart ?? prevNewEnd + 1) - 1

      if (upperBound <= prevNewEnd) {
        out.push(line)
        continue
      }

      let cursor = prevNewEnd + 1
      const isExpanded = (n: number) => expandedNewLines?.has(n)
      while (cursor <= upperBound) {
        if (isExpanded(cursor) && blobLines && cursor - 1 < blobLines.length) {
          const newLine = cursor
          const oldLine = prevOldEnd + (cursor - prevNewEnd)
          out.push({
            type: 'context',
            content: blobLines[newLine - 1] ?? '',
            oldLine,
            newLine,
          })
          cursor++
        } else {
          let runEnd = cursor
          while (runEnd <= upperBound && !isExpanded(runEnd)) runEnd++
          out.push({
            type: 'expander',
            content: '',
            expander: {
              prevOldEnd: prevOldEnd + (cursor - prevNewEnd - 1),
              prevNewEnd: cursor - 1,
              nextOldStart: isTail ? null : line.expander.nextOldStart,
              nextNewStart: isTail ? null : runEnd,
              isTail,
            },
          })
          cursor = runEnd
        }
      }
      continue
    }

    if (line.hunkId != null && line.type !== 'hunk' && collapsedHunks.has(line.hunkId)) {
      continue
    }
    out.push(line)
  }

  return out
}

/**
 * Split a concatenated unified diff (multiple files) into per-file chunks.
 * Recognises both `diff --git a/foo b/foo` headers and bare `--- /dev/null`
 * sections (used by `getWorkingFileDiff` for untracked files).
 */
export interface SplitFilePatch {
  filePath: string
  patch: string
}

export function splitPatchByFile(patch: string): SplitFilePatch[] {
  if (!patch) return []
  const lines = patch.split('\n')
  const out: SplitFilePatch[] = []
  let current: { headerLines: string[]; bodyLines: string[]; filePath: string | null } | null = null

  const flush = () => {
    if (!current) return
    const patch = [...current.headerLines, ...current.bodyLines].join('\n')
    out.push({ filePath: current.filePath ?? '(unknown)', patch })
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush()
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      const filePath = m ? m[2] : null
      current = { headerLines: [line], bodyLines: [], filePath }
    } else if (!current && line.startsWith('--- ')) {
      // Synthetic patch without `diff --git` header (e.g. single-file untracked).
      current = { headerLines: [line], bodyLines: [], filePath: null }
    } else if (current && current.filePath == null && line.startsWith('+++ b/')) {
      current.filePath = line.slice(6)
      current.headerLines.push(line)
    } else if (current) {
      current.bodyLines.push(line)
    }
  }
  flush()
  return out
}

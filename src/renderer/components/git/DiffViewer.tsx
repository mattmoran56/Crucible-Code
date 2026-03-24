import React from 'react'
import { useGitStore } from '../../stores/gitStore'

function parsePatch(patch: string) {
  const lines = patch.split('\n')
  const result: Array<{
    type: 'header' | 'context' | 'add' | 'delete' | 'hunk'
    content: string
    oldLine?: number
    newLine?: number
  }> = []

  let oldLine = 0
  let newLine = 0
  let inDiff = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inDiff = true
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      result.push({ type: 'hunk', content: line })
    } else if (!inDiff) {
      result.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      result.push({ type: 'add', content: line.slice(1), newLine: newLine++ })
    } else if (line.startsWith('-')) {
      result.push({ type: 'delete', content: line.slice(1), oldLine: oldLine++ })
    } else {
      result.push({ type: 'context', content: line.startsWith(' ') ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++ })
    }
  }

  return result
}

const LINE_STYLES: Record<string, string> = {
  header: 'text-text-muted bg-bg-tertiary',
  hunk: 'text-accent bg-accent/5',
  context: '',
  add: 'bg-success/10 text-success',
  delete: 'bg-danger/10 text-danger',
}

export function DiffViewer() {
  const { filePatch, selectedFilePath } = useGitStore()

  if (!selectedFilePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select a file to view diff
      </div>
    )
  }

  if (filePatch === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Loading...
      </div>
    )
  }

  const lines = parsePatch(filePatch)

  return (
    <div className="flex-1 overflow-auto font-mono text-xs">
      <div className="px-3 py-1.5 bg-bg-tertiary border-b border-border text-text-muted sticky top-0">
        {selectedFilePath}
      </div>
      <div>
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex px-2 leading-5 ${LINE_STYLES[line.type] || ''}`}
          >
            <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
              {line.oldLine ?? ''}
            </span>
            <span className="w-10 text-right text-text-muted/50 select-none pr-2 shrink-0">
              {line.newLine ?? ''}
            </span>
            <span className="w-4 text-center select-none shrink-0">
              {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ''}
            </span>
            <pre className="flex-1 whitespace-pre-wrap break-all">{line.content}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

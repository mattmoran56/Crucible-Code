import { EditorView } from '@codemirror/view'

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function createEditorTheme() {
  const bg = getCSSVar('--color-bg')
  const bgSecondary = getCSSVar('--color-bg-secondary')
  const text = getCSSVar('--color-text')
  const textMuted = getCSSVar('--color-text-muted')
  const accent = getCSSVar('--color-accent')
  const border = getCSSVar('--color-border')

  return EditorView.theme(
    {
      '&': {
        backgroundColor: bg,
        color: text,
        fontSize: '13px',
        height: '100%',
      },
      '.cm-content': {
        caretColor: accent,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        padding: '8px 0',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: accent,
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: `${accent}33`,
      },
      '.cm-activeLine': {
        backgroundColor: `${accent}0d`,
      },
      '.cm-gutters': {
        backgroundColor: bgSecondary,
        color: textMuted,
        border: 'none',
        borderRight: `1px solid ${border}`,
      },
      '.cm-activeLineGutter': {
        backgroundColor: `${accent}0d`,
        color: text,
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 12px',
        minWidth: '40px',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: bgSecondary,
        border: `1px solid ${border}`,
        color: textMuted,
        padding: '0 6px',
        margin: '0 2px',
        borderRadius: '3px',
      },
      '.cm-foldGutter': {
        color: textMuted,
        fontSize: '14px',
        width: '14px',
      },
      '.cm-foldGutter .cm-gutterElement': {
        padding: '0 2px',
        cursor: 'pointer',
      },
      '.cm-foldGutter .cm-gutterElement:hover': {
        color: accent,
      },
      '.cm-tooltip': {
        backgroundColor: bgSecondary,
        border: `1px solid ${border}`,
        color: text,
      },
      '.cm-panels': {
        backgroundColor: bgSecondary,
        color: text,
      },
      '.cm-searchMatch': {
        backgroundColor: `${accent}40`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: `${accent}66`,
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '.cm-scroller': {
        overflow: 'auto',
      },
    },
    { dark: true }
  )
}

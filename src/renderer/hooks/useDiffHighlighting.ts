import { useState, useEffect } from 'react'
import { createHighlighter, type Highlighter, type ThemedToken } from 'shiki'

// --- Singleton highlighter ---

let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>()

const THEMES = ['tokyo-night', 'github-light'] as const

const PRELOAD_LANGS = [
  'typescript', 'javascript', 'tsx', 'jsx', 'json', 'jsonc',
  'css', 'scss', 'html', 'xml',
  'markdown', 'yaml', 'toml',
  'python', 'rust', 'go', 'java', 'c', 'cpp',
  'bash', 'shell', 'sql', 'dockerfile',
]

async function getOrCreateHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [...THEMES],
      langs: PRELOAD_LANGS,
    })
    highlighterPromise.then((h) => {
      highlighter = h
      PRELOAD_LANGS.forEach((l) => loadedLangs.add(l))
    })
  }
  return highlighterPromise
}

// --- Language detection ---

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', fs: 'fsharp',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  md: 'markdown', mdx: 'mdx',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  vue: 'vue', svelte: 'svelte',
  php: 'php', lua: 'lua', zig: 'zig', r: 'r',
}

function langFromPath(filePath: string): string | null {
  const name = filePath.split('/').pop()?.toLowerCase() ?? ''
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile'
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile'
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return EXT_TO_LANG[ext] || null
}

// --- Theme mapping ---

function getShikiTheme(): 'tokyo-night' | 'github-light' {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark'
  return theme === 'light' || theme === 'soft-light' ? 'github-light' : 'tokyo-night'
}

// --- Core highlighting ---

export type TokenMap = Map<number, ThemedToken[]>

interface DiffLineInput {
  type: string
  content: string
  oldLine?: number
  newLine?: number
}

const HIGHLIGHT_LINE_THRESHOLD = 5000

/**
 * Splice the visible diff lines into the corresponding blob (or, when no blob
 * is provided, an array padded only with the visible lines). Returns:
 *   - `text`: the full source we hand to shiki, one line per element joined by '\n'.
 *   - `displayToLine`: for each visible display index `i`, the 1-based line
 *     number in `text` whose tokens belong to that display row.
 *
 * `side === 'new'` builds the post-edit file (uses `add` + `context` lines,
 * indexed by `newLine`). `side === 'old'` builds the pre-edit file (uses
 * `delete` + `context` lines, indexed by `oldLine`).
 */
export function buildFullText(
  lines: DiffLineInput[],
  blob: string[] | null,
  side: 'new' | 'old',
): { text: string; displayToLine: Map<number, number> } | null {
  const overrides = new Map<number, string>()
  const displayToLine = new Map<number, number>()
  let maxLine = blob?.length ?? 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const num = side === 'new' ? line.newLine : line.oldLine
    if (num == null) continue

    const include =
      line.type === 'context' ||
      (side === 'new' && line.type === 'add') ||
      (side === 'old' && line.type === 'delete')
    if (!include) continue

    overrides.set(num, line.content)
    displayToLine.set(i, num)
    if (num > maxLine) maxLine = num
  }

  if (maxLine === 0) return null

  const parts: string[] = new Array(maxLine)
  for (let n = 1; n <= maxLine; n++) {
    if (overrides.has(n)) {
      parts[n - 1] = overrides.get(n)!
    } else if (blob && n - 1 < blob.length) {
      parts[n - 1] = blob[n - 1]
    } else {
      parts[n - 1] = ''
    }
  }

  return { text: parts.join('\n'), displayToLine }
}

async function highlightDiffLines(
  lines: DiffLineInput[],
  filePath: string,
  blobLines: string[] | null,
): Promise<TokenMap | null> {
  if (lines.length > HIGHLIGHT_LINE_THRESHOLD) return null

  const lang = langFromPath(filePath)
  if (!lang) return null

  const h = await getOrCreateHighlighter()

  if (!loadedLangs.has(lang)) {
    try {
      await h.loadLanguage(lang as Parameters<typeof h.loadLanguage>[0])
      loadedLangs.add(lang)
    } catch {
      return null
    }
  }

  const theme = getShikiTheme()
  const tokenMap: TokenMap = new Map()

  // Build "new" side from blob (when available) so syntax highlighting has
  // proper context for hunks that start mid-class / mid-string. Without the
  // blob we still tokenise the concatenated visible new lines so highlighting
  // works for the common case.
  const newSide = buildFullText(lines, blobLines, 'new')
  if (newSide) {
    try {
      const result = h.codeToTokens(newSide.text, { lang: lang as Parameters<typeof h.codeToTokens>[1]['lang'], theme })
      for (const [displayIdx, lineNum] of newSide.displayToLine) {
        const tokens = result.tokens[lineNum - 1]
        if (tokens) tokenMap.set(displayIdx, tokens)
      }
    } catch {
      /* unsupported — fall through */
    }
  }

  // Old side: we don't have a base blob here yet, but tokenising the visible
  // (context + delete) lines still produces decent highlighting because the
  // sequence usually starts at a top-level token.
  const oldSide = buildFullText(lines, null, 'old')
  if (oldSide) {
    try {
      const result = h.codeToTokens(oldSide.text, { lang: lang as Parameters<typeof h.codeToTokens>[1]['lang'], theme })
      for (const [displayIdx, lineNum] of oldSide.displayToLine) {
        // Only set if we haven't already filled this index from the new side
        // (context lines are present in both — prefer new-side tokens).
        if (tokenMap.has(displayIdx)) continue
        const tokens = result.tokens[lineNum - 1]
        if (tokens) tokenMap.set(displayIdx, tokens)
      }
    } catch {
      /* unsupported — fall through */
    }
  }

  return tokenMap.size > 0 ? tokenMap : null
}

// --- React hook ---

export function useDiffHighlighting(
  lines: DiffLineInput[],
  filePath: string | null,
  blobLines?: string[] | null,
): TokenMap | null {
  const [tokenMap, setTokenMap] = useState<TokenMap | null>(null)

  useEffect(() => {
    if (!filePath) {
      setTokenMap(null)
      return
    }

    let cancelled = false

    highlightDiffLines(lines, filePath, blobLines ?? null).then((map) => {
      if (!cancelled) setTokenMap(map)
    })

    return () => {
      cancelled = true
    }
  }, [lines, filePath, blobLines])

  return tokenMap
}

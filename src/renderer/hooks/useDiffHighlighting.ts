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
}

async function highlightDiffLines(
  lines: DiffLineInput[],
  filePath: string,
): Promise<TokenMap | null> {
  const lang = langFromPath(filePath)
  if (!lang) return null

  const h = await getOrCreateHighlighter()

  // Lazy-load language if not already loaded
  if (!loadedLangs.has(lang)) {
    try {
      await h.loadLanguage(lang as Parameters<typeof h.loadLanguage>[0])
      loadedLangs.add(lang)
    } catch {
      return null
    }
  }

  const theme = getShikiTheme()

  // Reconstruct old (context + delete) and new (context + add) content
  // so shiki gets full context for accurate tokenisation
  const oldIndices: number[] = []
  const newIndices: number[] = []
  const oldContent: string[] = []
  const newContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.type === 'context') {
      oldIndices.push(i)
      newIndices.push(i)
      oldContent.push(line.content)
      newContent.push(line.content)
    } else if (line.type === 'delete') {
      oldIndices.push(i)
      oldContent.push(line.content)
    } else if (line.type === 'add') {
      newIndices.push(i)
      newContent.push(line.content)
    }
  }

  const tokenMap: TokenMap = new Map()

  if (oldContent.length > 0) {
    try {
      const result = h.codeToTokens(oldContent.join('\n'), { lang, theme })
      result.tokens.forEach((lineTokens, idx) => {
        if (idx < oldIndices.length) tokenMap.set(oldIndices[idx], lineTokens)
      })
    } catch {
      /* unsupported — fall through to plain text */
    }
  }

  if (newContent.length > 0) {
    try {
      const result = h.codeToTokens(newContent.join('\n'), { lang, theme })
      result.tokens.forEach((lineTokens, idx) => {
        if (idx < newIndices.length) tokenMap.set(newIndices[idx], lineTokens)
      })
    } catch {
      /* unsupported — fall through to plain text */
    }
  }

  return tokenMap.size > 0 ? tokenMap : null
}

// --- React hook ---

export function useDiffHighlighting(
  lines: DiffLineInput[],
  filePath: string | null,
): TokenMap | null {
  const [tokenMap, setTokenMap] = useState<TokenMap | null>(null)

  useEffect(() => {
    if (!filePath) {
      setTokenMap(null)
      return
    }

    let cancelled = false

    highlightDiffLines(lines, filePath).then((map) => {
      if (!cancelled) setTokenMap(map)
    })

    return () => {
      cancelled = true
    }
  }, [lines, filePath])

  return tokenMap
}

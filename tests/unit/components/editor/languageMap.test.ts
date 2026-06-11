import { describe, expect, it } from 'vitest'
import { getLanguageExtension } from '../../../../src/renderer/components/editor/languageMap'

// The map lazily imports a CodeMirror LanguageSupport per extension. We assert
// on the resolved language name so a swapped loader would fail the test.
async function langName(filePath: string): Promise<string | null> {
  const support = await getLanguageExtension(filePath)
  return support ? support.language.name : null
}

describe('getLanguageExtension — JavaScript family', () => {
  it('resolves .ts to the typescript dialect', async () => {
    const support = await getLanguageExtension('src/index.ts')
    expect(support).not.toBeNull()
    expect(support!.language.name).toBe('typescript')
  })

  it('resolves .tsx to the typescript dialect', async () => {
    expect(await langName('component.tsx')).toBe('typescript')
  })

  it('resolves .js', async () => {
    expect(await langName('main.js')).toBe('javascript')
  })

  it('resolves .mjs', async () => {
    expect(await langName('module.mjs')).toBe('javascript')
  })

  it('resolves .cjs', async () => {
    expect(await langName('legacy.cjs')).toBe('javascript')
  })

  it('resolves .jsx', async () => {
    expect(await langName('App.jsx')).toBe('javascript')
  })
})

describe('getLanguageExtension — other languages', () => {
  it('resolves .css', async () => {
    expect(await langName('styles.css')).toBe('css')
  })

  it('resolves .json', async () => {
    expect(await langName('package.json')).toBe('json')
  })

  it('resolves .md to markdown', async () => {
    expect(await langName('README.md')).toBe('markdown')
  })

  it('resolves .mdx to markdown', async () => {
    expect(await langName('page.mdx')).toBe('markdown')
  })

  it('resolves .py to python', async () => {
    expect(await langName('script.py')).toBe('python')
  })

  it('resolves .html', async () => {
    expect(await langName('index.html')).toBe('html')
  })

  it('resolves .htm', async () => {
    expect(await langName('old.htm')).toBe('html')
  })
})

describe('getLanguageExtension — extension parsing', () => {
  it('is case-insensitive on the extension', async () => {
    expect(await langName('INDEX.TS')).toBe('typescript')
    expect(await langName('Readme.MD')).toBe('markdown')
  })

  it('uses only the last dot segment', async () => {
    expect(await langName('archive.spec.ts')).toBe('typescript')
    expect(await langName('a.b.c.json')).toBe('json')
  })

  it('returns null for unknown extensions', async () => {
    expect(await getLanguageExtension('binary.exe')).toBeNull()
    expect(await getLanguageExtension('notes.txt')).toBeNull()
    expect(await getLanguageExtension('photo.png')).toBeNull()
  })

  it('returns null for files with no extension', async () => {
    // 'Makefile'.split('.').pop() is 'makefile' (lowercased) — not in the map.
    expect(await getLanguageExtension('Makefile')).toBeNull()
    expect(await getLanguageExtension('LICENSE')).toBeNull()
  })

  it('returns null for the empty string', async () => {
    expect(await getLanguageExtension('')).toBeNull()
  })

  it('treats dotfiles as their own extension', async () => {
    // '.gitignore'.split('.').pop() === 'gitignore' — unmapped.
    expect(await getLanguageExtension('.gitignore')).toBeNull()
  })

  it('handles full paths with directories', async () => {
    expect(await langName('/home/user/project/src/deep/nested/file.py')).toBe('python')
  })

  it('a trailing dot yields the empty extension and null', async () => {
    expect(await getLanguageExtension('weird.')).toBeNull()
  })

  it('extension-only names like ".ts" still resolve via the last segment', async () => {
    expect(await langName('.ts')).toBe('typescript')
  })

  it('returns a fresh LanguageSupport instance per call', async () => {
    const a = await getLanguageExtension('a.json')
    const b = await getLanguageExtension('b.json')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
  })
})

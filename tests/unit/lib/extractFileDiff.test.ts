import { describe, expect, it } from 'vitest'
import { extractFileDiff } from '../../../src/renderer/lib/extractFileDiff'

const FULL_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,3 @@
-const x = 1
+const x = 2
diff --git a/src/bar.ts b/src/bar.ts
index 3333333..4444444 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1,1 +1,1 @@
-old
+new
diff --git a/src/baz.ts b/src/baz.ts
index 5555555..6666666 100644
--- a/src/baz.ts
+++ b/src/baz.ts
@@ -1,1 +1,1 @@
-baz-old
+baz-new
`

describe('extractFileDiff', () => {
  it('returns the diff hunk for the requested file only', () => {
    const result = extractFileDiff(FULL_DIFF, 'src/bar.ts')
    expect(result).toContain('diff --git a/src/bar.ts b/src/bar.ts')
    expect(result).toContain('-old')
    expect(result).toContain('+new')
    expect(result).not.toContain('src/foo.ts')
    expect(result).not.toContain('src/baz.ts')
  })

  it('returns the first file when it is the requested one', () => {
    const result = extractFileDiff(FULL_DIFF, 'src/foo.ts')
    expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts')
    expect(result).toContain('-const x = 1')
    expect(result).not.toContain('src/bar.ts')
  })

  it('returns the last file when it is the requested one', () => {
    const result = extractFileDiff(FULL_DIFF, 'src/baz.ts')
    expect(result).toContain('diff --git a/src/baz.ts b/src/baz.ts')
    expect(result).toContain('+baz-new')
    expect(result).not.toContain('src/bar.ts')
  })

  it('returns empty string for unknown file', () => {
    expect(extractFileDiff(FULL_DIFF, 'src/missing.ts')).toBe('')
  })

  it('returns empty string for empty diff', () => {
    expect(extractFileDiff('', 'src/foo.ts')).toBe('')
  })
})

describe('extractFileDiff — exact extraction boundaries', () => {
  it('extracts a middle file verbatim, stopping before the next header', () => {
    const result = extractFileDiff(FULL_DIFF, 'src/bar.ts')
    expect(result).toBe(
      [
        'diff --git a/src/bar.ts b/src/bar.ts',
        'index 3333333..4444444 100644',
        '--- a/src/bar.ts',
        '+++ b/src/bar.ts',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
      ].join('\n'),
    )
  })

  it('keeps the trailing newline when the requested file is last in the diff', () => {
    const result = extractFileDiff(FULL_DIFF, 'src/baz.ts')
    expect(result.endsWith('+baz-new\n')).toBe(true)
  })

  it('works when the diff has a non-diff preamble before the first header', () => {
    const diff = 'commit abc123\nAuthor: someone\n\n' + 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b'
    const result = extractFileDiff(diff, 'x.ts')
    expect(result.startsWith('diff --git a/x.ts b/x.ts')).toBe(true)
    expect(result).toContain('+b')
    expect(result).not.toContain('commit abc123')
  })

  it('handles a single-file diff with no trailing newline', () => {
    const diff = 'diff --git a/only.ts b/only.ts\n@@ -1 +1 @@\n-x\n+y'
    expect(extractFileDiff(diff, 'only.ts')).toBe(diff)
  })

  it('does not stop on hunk content that merely contains "diff --git"', () => {
    const diff = [
      'diff --git a/notes.md b/notes.md',
      '@@ -1 +1,2 @@',
      ' intro',
      '+see diff --git docs for details',
      'diff --git a/other.md b/other.md',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')
    const result = extractFileDiff(diff, 'notes.md')
    expect(result).toContain('+see diff --git docs for details')
    expect(result).not.toContain('other.md')
  })
})

describe('extractFileDiff — path matching quirks (current behavior)', () => {
  it('a bare filename can false-positive onto a nested path ending with /<name>', () => {
    // "diff --git a/lib/bar.ts b/lib/bar.ts" contains the substring "b/bar.ts"
    // (inside "lib/bar.ts"), so requesting plain "bar.ts" captures it.
    const diff = 'diff --git a/lib/bar.ts b/lib/bar.ts\n@@ -1 +1 @@\n-x\n+y'
    const result = extractFileDiff(diff, 'bar.ts')
    expect(result).toContain('+y')
  })

  it('a path that is a prefix of another file false-positives (foo.ts matches foo.tsx)', () => {
    const diff = 'diff --git a/src/foo.tsx b/src/foo.tsx\n@@ -1 +1 @@\n-x\n+y'
    const result = extractFileDiff(diff, 'src/foo.ts')
    expect(result).toContain('diff --git a/src/foo.tsx b/src/foo.tsx')
  })

  it('prefers the exact file when it precedes the longer-named one', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '@@ -1 +1 @@',
      '-ts-old',
      '+ts-new',
      'diff --git a/src/foo.tsx b/src/foo.tsx',
      '@@ -1 +1 @@',
      '-tsx-old',
      '+tsx-new',
    ].join('\n')
    const result = extractFileDiff(diff, 'src/foo.ts')
    expect(result).toContain('+ts-new')
    expect(result).not.toContain('+tsx-new')
  })

  it('still finds the longer-named file when requested precisely', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '@@ -1 +1 @@',
      '-ts-old',
      '+ts-new',
      'diff --git a/src/foo.tsx b/src/foo.tsx',
      '@@ -1 +1 @@',
      '-tsx-old',
      '+tsx-new',
    ].join('\n')
    const result = extractFileDiff(diff, 'src/foo.tsx')
    expect(result).toContain('+tsx-new')
    expect(result).not.toContain('+ts-new')
  })

  it('matches the post-rename (b/) side of a renamed file', () => {
    const diff = [
      'diff --git a/old-name.ts b/new-name.ts',
      'similarity index 90%',
      'rename from old-name.ts',
      'rename to new-name.ts',
    ].join('\n')
    expect(extractFileDiff(diff, 'new-name.ts')).toContain('rename to new-name.ts')
    expect(extractFileDiff(diff, 'old-name.ts')).toBe('') // a/-side only — not found
  })

  it('an empty filePath captures the first file (b/ prefix matches everything)', () => {
    const result = extractFileDiff(FULL_DIFF, '')
    expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts')
    expect(result).not.toContain('src/bar.ts')
  })

  it('path comparison is case-sensitive', () => {
    expect(extractFileDiff(FULL_DIFF, 'SRC/FOO.TS')).toBe('')
  })

  it('paths with regex-special characters are matched literally', () => {
    const diff = 'diff --git a/src/a+b(c).ts b/src/a+b(c).ts\n@@ -1 +1 @@\n-x\n+y'
    expect(extractFileDiff(diff, 'src/a+b(c).ts')).toContain('+y')
  })

  it('unicode paths are matched', () => {
    const diff = 'diff --git a/src/файл.ts b/src/файл.ts\n@@ -1 +1 @@\n-x\n+y'
    expect(extractFileDiff(diff, 'src/файл.ts')).toContain('+y')
  })

  it('CRLF line endings do not prevent matching', () => {
    const diff = 'diff --git a/win.ts b/win.ts\r\n@@ -1 +1 @@\r\n-x\r\n+y\r\n'
    const result = extractFileDiff(diff, 'win.ts')
    expect(result).toContain('diff --git a/win.ts b/win.ts')
    expect(result).toContain('+y')
  })

  it('stays fast and correct on a very large multi-file diff', () => {
    const bigFile = (name: string) =>
      [`diff --git a/${name} b/${name}`, '@@ -1,2000 +1,2000 @@', ...Array.from({ length: 2000 }, (_, i) => `+line-${name}-${i}`)].join('\n')
    const big = [bigFile('aaa.ts'), bigFile('needle.ts'), bigFile('zzz.ts')].join('\n')
    const result = extractFileDiff(big, 'needle.ts')
    expect(result.startsWith('diff --git a/needle.ts b/needle.ts')).toBe(true)
    expect(result).toContain('+line-needle.ts-1999')
    expect(result).not.toContain('aaa')
    expect(result).not.toContain('zzz')
  })
})

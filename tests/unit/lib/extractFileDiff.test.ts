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

export function extractFileDiff(fullDiff: string, filePath: string): string {
  const lines = fullDiff.split('\n')
  let capture = false
  const result: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (capture) break
      if (line.includes(`b/${filePath}`)) {
        capture = true
      }
    }
    if (capture) {
      result.push(line)
    }
  }

  return result.join('\n')
}

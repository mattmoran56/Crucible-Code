import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../../src/main/services/terminal.service', () => ({
  AUTO_PERMISSION_MODE_ARGS: [],
}))

import {
  attachmentsDir,
  checkAttachments,
  safeFileName,
  saveAttachments,
} from '../../../src/main/services/visual-agent/attachments'
import { agentArgv, userMessageFrame } from '../../../src/main/services/visual-agent/launch'
import { MAX_ATTACHMENTS } from '../../../src/shared/visual-agent'

const b64 = (s: string): string => Buffer.from(s).toString('base64')

let dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs = []
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'va-attach-'))
  dirs.push(d)
  return d
}

describe('visual agent attachments', () => {
  it('keeps names to one safe path segment', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\me\\shot.png')).toBe('shot.png')
    expect(safeFileName('a]b[c.txt')).toBe('a_b_c.txt')
    expect(safeFileName('...')).toBe('attachment')
    expect(attachmentsDir('agent/../x')).toMatch(/crucible-code-attachments[\\/]agent_.._x$/)
  })

  it('checks what the renderer sent, measuring size itself', () => {
    expect(checkAttachments(undefined)).toEqual([])
    expect(checkAttachments([{ name: 'a.txt', type: 'text/plain', size: 999, data: b64('hi') }])).toEqual([
      { name: 'a.txt', type: 'text/plain', size: 2, data: b64('hi') },
    ])
    expect(() => checkAttachments('nope')).toThrow()
    expect(() => checkAttachments([{ name: 'a' }])).toThrow(/missing/)
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({ name: `${i}`, type: '', size: 1, data: b64('x') }))
    expect(() => checkAttachments(many)).toThrow(/at most/)
  })

  it('saves every file and makes image blocks only for inline images', () => {
    const dir = tmp()
    const saved = saveAttachments(
      dir,
      [
        { name: 'shot.png', type: 'image/png', size: 3, data: b64('png') },
        { name: 'notes.md', type: 'text/markdown', size: 5, data: b64('# hi!') },
      ],
      'stamp1',
    )
    expect(saved.paths).toEqual([join(dir, 'stamp1-0-shot.png'), join(dir, 'stamp1-1-notes.md')])
    expect(readFileSync(saved.paths[1], 'utf-8')).toBe('# hi!')
    expect(saved.images).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64('png') } }])
  })

  it('sends images ahead of the text in the user message', () => {
    const frame = JSON.parse(userMessageFrame('look', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } }]))
    expect(frame.message.content.map((b: { type: string }) => b.type)).toEqual(['image', 'text'])
    expect(JSON.parse(userMessageFrame('plain')).message.content).toEqual([{ type: 'text', text: 'plain' }])
  })

  it('lets Claude read the attachments folder', () => {
    const argv = agentArgv({ model: 'claude-opus-5-5', addDirs: ['/tmp/att'] })
    expect(argv[argv.indexOf('--add-dir') + 1]).toBe('/tmp/att')
    expect(agentArgv({ model: 'claude-opus-5-5' })).not.toContain('--add-dir')
  })
})

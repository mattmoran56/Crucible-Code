import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createFile,
  getFileStat,
  listDirectory,
  moveFile,
  readFileBase64,
  readFileContent,
  unwatchDirectory,
  watchDirectory,
  writeFileContent,
} from '../../../src/main/services/file.service'
import { IPC } from '../../../src/shared/constants'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cc-file-test-'))
})

afterEach(async () => {
  unwatchDirectory(root)
  await rm(root, { recursive: true, force: true })
})

describe('file.service listDirectory', () => {
  it('lists files and directories, directories first then alphabetical', async () => {
    await writeFile(join(root, 'b.txt'), 'b')
    await writeFile(join(root, 'a.txt'), 'a')
    await mkdir(join(root, 'zdir'))
    await mkdir(join(root, 'adir'))

    const entries = await listDirectory(root)
    expect(entries.map((e) => e.name)).toEqual(['adir', 'zdir', 'a.txt', 'b.txt'])
    expect(entries[0].isDirectory).toBe(true)
    expect(entries[2].isDirectory).toBe(false)
  })

  it('returns absolute paths joined onto the listed directory', async () => {
    await writeFile(join(root, 'f.txt'), 'x')
    const entries = await listDirectory(root)
    expect(entries[0].path).toBe(join(root, 'f.txt'))
  })

  it('filters out node_modules, .git, worktree dirs and OS junk files', async () => {
    await mkdir(join(root, 'node_modules'))
    await mkdir(join(root, '.git'))
    await mkdir(join(root, '.codecrucible-worktrees'))
    await writeFile(join(root, '.DS_Store'), '')
    await writeFile(join(root, 'Thumbs.db'), '')
    await writeFile(join(root, 'keep.txt'), 'k')

    const entries = await listDirectory(root)
    expect(entries.map((e) => e.name)).toEqual(['keep.txt'])
  })

  it('filters any entry starting with .git (including .gitignore and .github) but keeps other dotfiles', async () => {
    // Current behavior: the `startsWith('.git')` filter is broader than just
    // the .git directory — .gitignore and .github are hidden too.
    await writeFile(join(root, '.gitignore'), '')
    await mkdir(join(root, '.github'))
    await writeFile(join(root, '.env'), '')

    const entries = await listDirectory(root)
    expect(entries.map((e) => e.name)).toEqual(['.env'])
  })
})

describe('file.service read/write/create/move', () => {
  it('readFileContent returns UTF-8 file content inside the root', async () => {
    const p = join(root, 'hello.txt')
    await writeFile(p, 'hello world\n')
    await expect(readFileContent(p, root)).resolves.toBe('hello world\n')
  })

  it('readFileContent rejects paths outside the repository root', async () => {
    await expect(readFileContent('/etc/hostname', root)).rejects.toThrow(
      'outside the repository root'
    )
  })

  it('readFileContent rejects files larger than the 5MB cap', async () => {
    const p = join(root, 'big.bin')
    await writeFile(p, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61))
    await expect(readFileContent(p, root)).rejects.toThrow('File is too large')
  })

  it('path validation is prefix-based: a sibling dir sharing the root prefix is allowed', async () => {
    // Current behavior: `resolved.startsWith(resolvedRoot)` without a trailing
    // separator check, so /tmp/<root>-evil passes validation for root /tmp/<root>.
    const sibling = `${root}-evil`
    await mkdir(sibling, { recursive: true })
    const p = join(sibling, 'f.txt')
    await writeFile(p, 'sneaky')
    await expect(readFileContent(p, root)).resolves.toBe('sneaky')
    await rm(sibling, { recursive: true, force: true })
  })

  it('writeFileContent writes UTF-8 content', async () => {
    const p = join(root, 'out.txt')
    await writeFileContent(p, 'written ✓', root)
    await expect(readFile(p, 'utf-8')).resolves.toBe('written ✓')
  })

  it('writeFileContent refuses to write outside the root', async () => {
    await expect(writeFileContent('/tmp/cc-escape.txt', 'x', root)).rejects.toThrow(
      'outside the repository root'
    )
  })

  it('createFile creates intermediate directories and an empty file', async () => {
    const p = join(root, 'deep', 'nested', 'new.txt')
    await createFile(p, root)
    await expect(readFile(p, 'utf-8')).resolves.toBe('')
  })

  it('moveFile renames a file, creating the destination directory', async () => {
    const src = join(root, 'src.txt')
    await writeFile(src, 'moving')
    const dest = join(root, 'sub', 'dest.txt')
    await moveFile(src, dest, root)
    await expect(readFile(dest, 'utf-8')).resolves.toBe('moving')
    expect(existsSync(src)).toBe(false)
  })

  it('moveFile validates both endpoints against the root', async () => {
    const src = join(root, 'src2.txt')
    await writeFile(src, 'x')
    await expect(moveFile(src, '/tmp/cc-escape-dest.txt', root)).rejects.toThrow(
      'outside the repository root'
    )
  })

  it('readFileBase64 round-trips binary content', async () => {
    const p = join(root, 'bin.dat')
    const buf = Buffer.from([0, 1, 2, 250, 255])
    await writeFile(p, buf)
    const b64 = await readFileBase64(p, root)
    expect(Buffer.from(b64, 'base64')).toEqual(buf)
  })

  it('getFileStat reports size and existence for a real file', async () => {
    const p = join(root, 's.txt')
    await writeFile(p, '12345')
    await expect(getFileStat(p)).resolves.toEqual({ size: 5, exists: true })
  })

  it('getFileStat returns exists:false instead of throwing for a missing file', async () => {
    await expect(getFileStat(join(root, 'nope.txt'))).resolves.toEqual({
      size: 0,
      exists: false,
    })
  })
})

describe('file.service watchDirectory', () => {
  it('debounces change events and sends FILE_CHANGED for each changed path', async () => {
    const send = vi.fn()
    const window = {
      isDestroyed: () => false,
      webContents: { send },
    } as never

    watchDirectory(root, window)
    await writeFile(join(root, 'watched.txt'), 'v1')

    await vi.waitFor(
      () => {
        const calls = send.mock.calls.filter((c) => c[0] === IPC.FILE_CHANGED)
        expect(calls.length).toBeGreaterThan(0)
        expect(calls.some((c) => String(c[1]).endsWith('watched.txt'))).toBe(true)
      },
      { timeout: 3000, interval: 50 }
    )
  })

  it('unwatchDirectory stops further notifications', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } } as never

    watchDirectory(root, window)
    await writeFile(join(root, 'first.txt'), 'x')
    await vi.waitFor(
      () => expect(send.mock.calls.length).toBeGreaterThan(0),
      { timeout: 3000, interval: 50 }
    )

    unwatchDirectory(root)
    send.mockClear()
    await writeFile(join(root, 'second.txt'), 'y')
    // Wait past the 300ms debounce window — nothing should arrive.
    await new Promise((r) => setTimeout(r, 600))
    expect(send).not.toHaveBeenCalled()
  })

  it('watchDirectory is idempotent for the same path (second call is a no-op)', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } } as never
    watchDirectory(root, window)
    expect(() => watchDirectory(root, window)).not.toThrow()
    unwatchDirectory(root)
    // Unwatching again must not throw either.
    expect(() => unwatchDirectory(root)).not.toThrow()
  })
})

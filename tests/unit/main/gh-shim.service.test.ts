import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'

// ensureGhShimInstalled writes into app.getPath('userData') — point it at a temp dir.
const tmpUserData = mkdtempSync(join(tmpdir(), 'gh-shim-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => tmpUserData } }))

let mod: typeof import('../../../src/main/services/gh-shim.service')

// A stub of the notification server /local-pr endpoint.
let server: http.Server
let port = 0
let lastBody: any = null
let respond: () => Record<string, unknown> = () => ({ ok: true, number: 1, url: 'https://github.com/local/local/pull/1' })

beforeAll(async () => {
  mod = await import('../../../src/main/services/gh-shim.service')
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try { lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { lastBody = null }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(respond()))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as any).port
})

afterAll(() => {
  server.close()
  rmSync(tmpUserData, { recursive: true, force: true })
})

let fakeBin: string
beforeEach(() => {
  lastBody = null
  respond = () => ({ ok: true, number: 1, url: 'https://github.com/local/local/pull/1' })
  // A fake "real" gh on PATH so passthrough is observable.
  fakeBin = mkdtempSync(join(tmpdir(), 'gh-shim-bin-'))
  writeFileSync(join(fakeBin, 'gh'), '#!/bin/sh\necho "PASSTHROUGH $*"\n', { mode: 0o755 })
  chmodSync(join(fakeBin, 'gh'), 0o755)
})
afterEach(() => rmSync(fakeBin, { recursive: true, force: true }))

function runShim(args: string[], extraEnv: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  const shimDir = mod.ensureGhShimInstalled()
  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    CRUCIBLE_LOCAL_PR: '1',
    CRUCIBLE_GH_SHIM_DIR: shimDir,
    CRUCIBLE_NOTIFY_PORT: String(port),
    CRUCIBLE_CONTEXT_ID: 'ctx-1',
    CRUCIBLE_TAB_ID: 'agent',
    ...extraEnv,
  }
  return new Promise((resolve) => {
    execFile('sh', [join(shimDir, 'gh'), ...args], { env }, (err: any, stdout, stderr) => {
      resolve({ stdout: String(stdout), stderr: String(stderr), code: err?.code ?? 0 })
    })
  })
}

describe('gh-shim.service', () => {
  it('installs an executable shim with the current version', () => {
    const dir = mod.ensureGhShimInstalled()
    const script = readFileSync(join(dir, 'gh'), 'utf8')
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    expect(script).toContain('CRUCIBLE_LOCAL_PR')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toMatch(/^\d+$/)
  })

  it('captures `gh pr create`, base64-encoding multi-line title/body, and prints the returned url', async () => {
    const { stdout } = await runShim(['pr', 'create', '--title', 'Hi there', '--body', 'line1\nline2\n`backtick`', '--base', 'main', '--head', 'feat/x', '--draft'])
    expect(lastBody).toBeTruthy()
    expect(lastBody.action).toBe('create')
    expect(Buffer.from(lastBody.title_b64, 'base64').toString('utf8')).toBe('Hi there')
    expect(Buffer.from(lastBody.body_b64, 'base64').toString('utf8')).toBe('line1\nline2\n`backtick`')
    expect(lastBody.base).toBe('main')
    expect(lastBody.head).toBe('feat/x')
    expect(lastBody.draft).toBe(true)
    expect(stdout.trim()).toBe('https://github.com/local/local/pull/1')
  })

  it('captures `gh pr edit` with --body-file', async () => {
    const bodyFile = join(fakeBin, 'body.md')
    writeFileSync(bodyFile, '# Checklist\n- [x] done')
    await runShim(['pr', 'edit', '1', '--body-file', bodyFile])
    expect(lastBody.action).toBe('edit')
    expect(Buffer.from(lastBody.body_b64, 'base64').toString('utf8')).toBe('# Checklist\n- [x] done')
    expect(lastBody.have_body).toBe(1)
  })

  it('captures `gh pr ready`', async () => {
    await runShim(['pr', 'ready'])
    expect(lastBody.action).toBe('ready')
  })

  it('serves `gh pr view --json` from the returned view payload', async () => {
    respond = () => ({ ok: true, view_b64: Buffer.from(JSON.stringify({ number: 1, title: 'T' })).toString('base64') })
    const { stdout } = await runShim(['pr', 'view', '--json', 'number,title'])
    expect(lastBody.action).toBe('view')
    expect(lastBody.json).toBe('number,title')
    expect(JSON.parse(stdout)).toEqual({ number: 1, title: 'T' })
  })

  it('passes non-PR gh commands through to the real gh', async () => {
    const { stdout } = await runShim(['repo', 'view'])
    expect(stdout).toContain('PASSTHROUGH repo view')
    expect(lastBody).toBeNull() // never hit the capture server
  })

  it('passes everything through when capture is off', async () => {
    const { stdout } = await runShim(['pr', 'create', '--title', 'X'], { CRUCIBLE_LOCAL_PR: '0' })
    expect(stdout).toContain('PASSTHROUGH pr create')
    expect(lastBody).toBeNull()
  })
})

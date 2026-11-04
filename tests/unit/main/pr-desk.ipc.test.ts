import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, ipcMain: { handle: vi.fn() }, app: { getPath: () => '/tmp', isPackaged: false } }))
vi.mock('../../../src/main/store-path', () => ({ getStorePath: () => '/tmp' }))
vi.mock('electron-store', () => ({ default: class { get() { return {} } set() {} } }))
vi.mock('../../../src/main/services/pr-desk.service', () => ({ listDeskPRs: vi.fn(), getDeskTickets: vi.fn() }))

import { isDeskExternalUrl } from '../../../src/main/ipc/pr-desk.ipc'

describe('isDeskExternalUrl', () => {
  it('allows https GitHub and Notion links', () => {
    expect(isDeskExternalUrl('https://github.com/o/r/pull/1')).toBe(true)
    expect(isDeskExternalUrl('https://www.notion.so/abc')).toBe(true)
    expect(isDeskExternalUrl('https://notion.so/abc')).toBe(true)
    expect(isDeskExternalUrl('https://team.notion.site/abc')).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isDeskExternalUrl('http://github.com/o/r')).toBe(false)
    expect(isDeskExternalUrl('https://github.com.evil.example/x')).toBe(false)
    expect(isDeskExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isDeskExternalUrl('not a url')).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { relayCloudWebNotification, resolveCloudNotificationSession, type ResolveDeps } from '../../../src/renderer/lib/cloudNotifications'
import { useCloudNoticeStore } from '../../../src/renderer/stores/cloudNoticeStore'
import type { Session } from '../../../src/shared/types'

const session = (id: string, cloudId?: string): Session =>
  ({ id, name: id, projectId: 'p', branchName: 'b', worktreePath: '/w', createdAt: '', ...(cloudId ? { cloud: { sessionId: cloudId, url: '' } } : {}) }) as unknown as Session

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    loaded: () => [session('s1', 'session_LoadedOne1')],
    projectIds: () => ['p1', 'p2'],
    listSessions: vi.fn(async (pid: string) => (pid === 'p2' ? [session('s9', 'session_OtherProj1')] : [])),
    sessionOfGuest: () => 'guest-session',
    ...over,
  }
}

const event = (cloudSessionId: string | null) => ({ webContentsId: 3, title: 'Claude needs your input', body: 'Approve?', cloudSessionId })

describe('resolveCloudNotificationSession', () => {
  it('matches the named cloud session in the loaded sessions first', async () => {
    const d = deps()
    expect(await resolveCloudNotificationSession(event('session_LoadedOne1'), d)).toBe('s1')
    expect(d.listSessions).not.toHaveBeenCalled()
  })

  it("looks through every project's sessions", async () => {
    expect(await resolveCloudNotificationSession(event('session_OtherProj1'), deps())).toBe('s9')
  })

  it("returns null for a cloud session the app doesn't have", async () => {
    expect(await resolveCloudNotificationSession(event('session_Unknown001'), deps())).toBeNull()
  })

  it('falls back to the session whose page raised it', async () => {
    expect(await resolveCloudNotificationSession(event(null), deps())).toBe('guest-session')
  })
})

describe('relayCloudWebNotification', () => {
  beforeEach(() => {
    useCloudNoticeStore.setState({ notices: {} })
    ;(window as any).api = { notification: { relayCloudNotification: vi.fn(async () => {}) } }
  })

  it('remembers the notice on the session and asks main to show it', async () => {
    await relayCloudWebNotification(event('session_LoadedOne1'), deps(), () => 123)
    expect(useCloudNoticeStore.getState().notices.s1).toEqual({
      title: 'Claude needs your input',
      body: 'Approve?',
      kind: 'attention',
      at: 123,
    })
    expect((window as any).api.notification.relayCloudNotification).toHaveBeenCalledWith(
      's1',
      'Claude needs your input',
      'Approve?',
      'attention',
    )
  })

  it('still shows a notification about an unknown session, with no session', async () => {
    await relayCloudWebNotification({ ...event('session_Unknown001'), title: 'Session finished', body: '' }, deps())
    expect(useCloudNoticeStore.getState().notices).toEqual({})
    expect((window as any).api.notification.relayCloudNotification).toHaveBeenCalledWith(null, 'Session finished', '', 'completed')
  })

  it('dismiss clears the notice', async () => {
    await relayCloudWebNotification(event('session_LoadedOne1'), deps())
    useCloudNoticeStore.getState().dismiss('s1')
    expect(useCloudNoticeStore.getState().notices).toEqual({})
  })
})

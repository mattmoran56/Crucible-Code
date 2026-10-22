import { beforeEach, describe, expect, it } from 'vitest'
import { warnAboutSandboxTeardown } from '../../../src/renderer/lib/sandboxTeardown'
import { useProjectStore } from '../../../src/renderer/stores/projectStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

function toasts() {
  return useToastStore.getState().toasts.map((t) => t.message)
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] } as any)
  useProjectStore.setState({
    projects: [
      { id: 'on', name: 'On', repoPath: '/on', sandboxer: { enabled: true } },
      { id: 'off', name: 'Off', repoPath: '/off' },
    ],
  } as any)
})

describe('warnAboutSandboxTeardown', () => {
  it('stays quiet when everything was destroyed, or nothing was reported', () => {
    warnAboutSandboxTeardown({ removed: ['acme/a'], failed: [] }, '/on')
    warnAboutSandboxTeardown(undefined, '/on')
    expect(toasts()).toEqual([])
  })

  it('reports a sandbox that survived', () => {
    warnAboutSandboxTeardown({ removed: [], failed: ['acme/a: boom'] }, '/off')
    expect(toasts()[0]).toMatch(/Sandbox not destroyed — acme\/a: boom/)
  })

  it('warns about a skipped check only for projects that use Sandboxer', () => {
    warnAboutSandboxTeardown({ removed: [], failed: [], skipped: 'spawn sandboxer ENOENT' }, '/off')
    expect(toasts()).toEqual([])
    warnAboutSandboxTeardown({ removed: [], failed: [], skipped: 'Docker is not running' }, '/on')
    expect(toasts()[0]).toMatch(/Docker is not running/)
  })
})

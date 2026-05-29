import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// jsdom's localStorage isn't reliably exposed at the global scope under our
// vitest config — polyfill a minimal in-memory store before importing modules
// that read it at evaluation time.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}

import { ProjectTabs } from '../../../remote/receiver/src/components/ProjectTabs'
import { SessionSidebar } from '../../../remote/receiver/src/components/SessionSidebar'
import { ThemeRadioList } from '../../../remote/receiver/src/components/ThemePicker'
import { MobileNav } from '../../../remote/receiver/src/components/MobileNav'

describe('receiver/ProjectTabs', () => {
  it('marks the active project tab and routes clicks to onSelect', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <ProjectTabs
        projects={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ]}
        activeProjectId="a"
        onSelect={onSelect}
      />
    )
    const alpha = screen.getByRole('tab', { name: 'Alpha' })
    const beta = screen.getByRole('tab', { name: 'Beta' })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(beta).toHaveAttribute('aria-selected', 'false')
    await user.click(beta)
    expect(onSelect).toHaveBeenCalledWith('b')
  })
})

describe('receiver/SessionSidebar', () => {
  const sessions = [
    { id: 's1', name: 'First', branchName: 'feat/a' },
    { id: 's2', name: 'Second' },
  ]

  it('renders sessions with branch names and routes clicks', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <SessionSidebar
        sessions={sessions}
        activeSessionId="s1"
        settingsOpen={false}
        onSelectSession={onSelect}
        onOpenSettings={() => {}}
      />
    )
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('feat/a')).toBeInTheDocument()
    await user.click(screen.getByText('Second'))
    expect(onSelect).toHaveBeenCalledWith('s2')
  })

  it('routes settings clicks to onOpenSettings', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <SessionSidebar
        sessions={sessions}
        activeSessionId={null}
        settingsOpen={false}
        onSelectSession={() => {}}
        onOpenSettings={onOpen}
      />
    )
    await user.click(screen.getByText('Settings'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('shows a loading state until sessions arrive', () => {
    render(
      <SessionSidebar
        sessions={null}
        activeSessionId={null}
        settingsOpen={false}
        onSelectSession={() => {}}
        onOpenSettings={() => {}}
      />
    )
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
  })
})

describe('receiver/ThemeRadioList', () => {
  // jsdom's localStorage is sometimes flaky to access at the very first
  // beforeEach in a file — read it indirectly through window when defined.
  beforeEach(() => {
    try { window.localStorage?.clear() } catch { /* not provided */ }
    document.documentElement.removeAttribute('data-theme')
  })

  it('shows the four themes as radio buttons and applies the chosen one to <html>', async () => {
    const user = userEvent.setup()
    render(<ThemeRadioList />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(4)
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('the active theme is reflected in aria-checked', async () => {
    const user = userEvent.setup()
    render(<ThemeRadioList />)
    await user.click(screen.getByRole('radio', { name: 'Ultra Dark' }))
    expect(screen.getByRole('radio', { name: 'Ultra Dark' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })
})

describe('receiver/MobileNav', () => {
  const baseProps = {
    open: true,
    onClose: () => {},
    projects: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
    activeProjectId: 'a',
    onSelectProject: vi.fn(),
    sessions: [{ id: 's1', name: 'First' }],
    activeSessionId: null,
    settingsOpen: false,
    onSelectSession: vi.fn(),
    onOpenSettings: vi.fn(),
  }

  it('renders project picker, session list, and settings entry when open', () => {
    render(<MobileNav {...baseProps} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('clicking a session calls onSelectSession with its id', async () => {
    const onSelectSession = vi.fn()
    const user = userEvent.setup()
    render(<MobileNav {...baseProps} onSelectSession={onSelectSession} />)
    await user.click(screen.getByText('First'))
    expect(onSelectSession).toHaveBeenCalledWith('s1')
  })

  it('clicking outside the drawer triggers onClose via Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<MobileNav {...baseProps} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

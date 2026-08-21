import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  SettingsSidebar,
  type SettingsSection,
} from '../../../../src/renderer/components/settings/SettingsSidebar'

function renderSidebar(
  overrides: Partial<{
    active: SettingsSection
    onChange: (s: SettingsSection) => void
    hasProjects: boolean
  }> = {}
) {
  const onChange = overrides.onChange ?? vi.fn()
  const utils = render(
    <SettingsSidebar
      active={overrides.active ?? 'appearance'}
      onChange={onChange}
      hasProjects={overrides.hasProjects ?? true}
    />
  )
  return { onChange, ...utils }
}

describe('SettingsSidebar', () => {
  it('renders every nav item when projects exist', () => {
    renderSidebar({ hasProjects: true })
    const labels = [
      'Appearance',
      'Cleanup & Limits',
      'Claude Accounts',
      'Buttons',
      'Overseer',
      'Project Defaults',
      'PR List Display',
      'Startup Prompts',
      'Notion',
      'Review Loop',
      'Foundry',
      'About',
    ]
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('renders exactly twelve nav buttons when projects exist', () => {
    renderSidebar({ hasProjects: true })
    expect(screen.getAllByRole('button')).toHaveLength(12)
  })

  it('hides project-requiring items when there are no projects', () => {
    renderSidebar({ hasProjects: false })
    expect(screen.queryByRole('button', { name: 'Project Defaults' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Startup Prompts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notion' })).not.toBeInTheDocument()
  })

  it('keeps PR List Display and Review Loop visible without projects', () => {
    renderSidebar({ hasProjects: false })
    expect(screen.getByRole('button', { name: 'PR List Display' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review Loop' })).toBeInTheDocument()
  })

  it('shows the General and Per Project group headings', () => {
    renderSidebar({ hasProjects: true })
    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Per Project')).toBeInTheDocument()
  })

  it('still shows the Per Project heading without projects (group is not empty)', () => {
    renderSidebar({ hasProjects: false })
    expect(screen.getByText('Per Project')).toBeInTheDocument()
  })

  it('calls onChange with the section id when an item is clicked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSidebar()
    await user.click(screen.getByRole('button', { name: 'Cleanup & Limits' }))
    expect(onChange).toHaveBeenCalledWith('cleanup-limits')
  })

  it('calls onChange with "about" for the About item', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSidebar()
    await user.click(screen.getByRole('button', { name: 'About' }))
    expect(onChange).toHaveBeenCalledWith('about')
  })

  it('calls onChange even when the active item is clicked again', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSidebar({ active: 'appearance' })
    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(onChange).toHaveBeenCalledWith('appearance')
  })

  it('highlights the active item with the accent class', () => {
    renderSidebar({ active: 'notion' })
    const activeBtn = screen.getByRole('button', { name: 'Notion' })
    expect(activeBtn.className).toContain('text-accent')
    expect(activeBtn.className).toContain('font-medium')
  })

  it('does not highlight inactive items', () => {
    renderSidebar({ active: 'notion' })
    const inactive = screen.getByRole('button', { name: 'Appearance' })
    expect(inactive.className).not.toContain('text-accent')
  })

  it('orders global items before project items before About', () => {
    renderSidebar({ hasProjects: true })
    const labels = screen.getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual([
      'Appearance',
      'Cleanup & Limits',
      'Claude Accounts',
      'Buttons',
      'Overseer',
      'Project Defaults',
      'PR List Display',
      'Startup Prompts',
      'Notion',
      'Review Loop',
      'Foundry',
      'About',
    ])
  })

  it('all nav items are type="button" so they never submit forms', () => {
    renderSidebar()
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toHaveAttribute('type', 'button')
    }
  })

  it('renders inside a nav landmark within an aside', () => {
    const { container } = renderSidebar()
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(within(aside as HTMLElement).getByRole('navigation')).toBeInTheDocument()
  })

  it('the meta group renders no heading label', () => {
    renderSidebar()
    // Only two group headings exist; the meta group label is the empty string.
    const headings = screen
      .getAllByText(/General|Per Project/)
      .map((el) => el.textContent)
    expect(headings).toEqual(['General', 'Per Project'])
  })
})

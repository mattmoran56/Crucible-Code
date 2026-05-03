import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar, SidebarSection } from '../../../../src/renderer/components/ui/Sidebar'

describe('Sidebar', () => {
  it('renders children inside an <aside>', () => {
    render(<Sidebar>hello</Sidebar>)
    const aside = screen.getByText('hello').closest('aside')
    expect(aside).not.toBeNull()
  })
})

describe('SidebarSection', () => {
  it('renders the title and children', () => {
    render(
      <SidebarSection title="Sessions">
        <div>child</div>
      </SidebarSection>
    )
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('child')).toBeInTheDocument()
  })

  it('hides children when collapsed', () => {
    render(
      <SidebarSection title="Sessions" collapsible collapsed>
        <div>child</div>
      </SidebarSection>
    )
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.queryByText('child')).not.toBeInTheDocument()
  })

  it('fires onToggle when the header is clicked and collapsible', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <SidebarSection title="Sessions" collapsible onToggle={onToggle}>
        <div>child</div>
      </SidebarSection>
    )
    await user.click(screen.getByText('Sessions'))
    expect(onToggle).toHaveBeenCalled()
  })

  it('does not toggle when not collapsible', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <SidebarSection title="Sessions" onToggle={onToggle}>
        <div>child</div>
      </SidebarSection>
    )
    await user.click(screen.getByText('Sessions'))
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('renders the badge when count > 0', () => {
    render(
      <SidebarSection title="Pull Requests" badge={3}>
        <div>x</div>
      </SidebarSection>
    )
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('hides the badge when count is 0', () => {
    render(
      <SidebarSection title="Pull Requests" badge={0}>
        <div>x</div>
      </SidebarSection>
    )
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('clicking inside the action does not toggle the section', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <SidebarSection
        title="X"
        collapsible
        onToggle={onToggle}
        action={<button>action</button>}
      >
        <div>x</div>
      </SidebarSection>
    )
    await user.click(screen.getByRole('button', { name: 'action' }))
    expect(onToggle).not.toHaveBeenCalled()
  })
})

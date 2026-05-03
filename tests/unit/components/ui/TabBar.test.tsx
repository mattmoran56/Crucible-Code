import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tab, TabBar } from '../../../../src/renderer/components/ui/TabBar'

describe('TabBar', () => {
  it('exposes itself as a tablist with the right aria-label', () => {
    render(
      <TabBar label="Workspace">
        <Tab active>One</Tab>
        <Tab>Two</Tab>
      </TabBar>
    )
    expect(screen.getByRole('tablist', { name: 'Workspace' })).toBeInTheDocument()
  })

  it('renders each child as a tab and marks the active one', () => {
    render(
      <TabBar label="X">
        <Tab>One</Tab>
        <Tab active>Two</Tab>
        <Tab>Three</Tab>
      </TabBar>
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking a Tab fires its onClick', async () => {
    const user = userEvent.setup()
    let clicked = ''
    render(
      <TabBar label="X">
        <Tab onClick={() => (clicked = 'one')}>One</Tab>
        <Tab onClick={() => (clicked = 'two')}>Two</Tab>
      </TabBar>
    )
    await user.click(screen.getByRole('tab', { name: 'Two' }))
    expect(clicked).toBe('two')
  })
})

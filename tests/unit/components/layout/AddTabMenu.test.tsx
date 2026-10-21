import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddTabMenu, AgentViewSwitch } from '../../../../src/renderer/components/layout/WorkspaceColumn'

describe('AddTabMenu', () => {
  it('hides New Visual Agent when the project has not opted in', async () => {
    render(<AddTabMenu columnId="c1" onAdd={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    expect(screen.getByText('New Agent')).toBeInTheDocument()
    expect(screen.getByText('New Terminal')).toBeInTheDocument()
    expect(screen.queryByText('New Visual Agent')).not.toBeInTheDocument()
  })

  it('offers New Visual Agent when enabled and adds a visual-agent tab', async () => {
    const onAdd = vi.fn()
    render(<AddTabMenu columnId="c1" onAdd={onAdd} visualAgentsEnabled />)
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    await userEvent.click(screen.getByText('New Visual Agent'))
    expect(onAdd).toHaveBeenCalledWith('c1', 'visual-agent')
    expect(screen.queryByText('New Visual Agent')).not.toBeInTheDocument()
  })
})

describe('AgentViewSwitch', () => {
  it('marks the current view and reports a change', async () => {
    const onChange = vi.fn()
    render(<AgentViewSwitch view="terminal" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Terminal' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('radio', { name: 'Visual' }))
    expect(onChange).toHaveBeenCalledWith('visual')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddTabMenu } from '../../../../src/renderer/components/layout/WorkspaceColumn'

describe('AddTabMenu', () => {
  it('offers New Agent and New Terminal, and no separate visual entry', async () => {
    render(<AddTabMenu columnId="c1" onAdd={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    expect(screen.getByText('New Agent')).toBeInTheDocument()
    expect(screen.getByText('New Terminal')).toBeInTheDocument()
    expect(screen.queryByText('New Visual Agent')).not.toBeInTheDocument()
  })

  it('New Agent adds an agent tab (rendered as a visual agent) and closes the menu', async () => {
    const onAdd = vi.fn()
    render(<AddTabMenu columnId="c1" onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    await userEvent.click(screen.getByText('New Agent'))
    expect(onAdd).toHaveBeenCalledWith('c1', 'agent')
    expect(screen.queryByText('New Agent')).not.toBeInTheDocument()
  })

  it('New Terminal still adds a plain terminal tab', async () => {
    const onAdd = vi.fn()
    render(<AddTabMenu columnId="c1" onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add tab' }))
    await userEvent.click(screen.getByText('New Terminal'))
    expect(onAdd).toHaveBeenCalledWith('c1', 'terminal')
  })
})

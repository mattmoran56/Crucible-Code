import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ButtonGroupRenderer,
  CustomButtonRenderer,
} from '../../../../src/renderer/components/buttons/CustomButtonRenderer'
import { useButtonStore } from '../../../../src/renderer/stores/buttonStore'
import type { CustomButton, CustomButtonGroup } from '../../../../src/shared/types'

function makeButton(overrides: Partial<CustomButton> = {}): CustomButton {
  return {
    id: 'b1',
    label: 'Deploy',
    icon: 'Rocket',
    placement: 'session-toolbar',
    actionType: 'shell',
    executionMode: 'background',
    command: 'npm run deploy',
    scope: { type: 'global' },
    order: 0,
    ...overrides,
  }
}

const group: CustomButtonGroup = {
  id: 'g1',
  label: 'Tools',
  icon: 'Wrench',
  placement: 'session-toolbar',
  scope: { type: 'global' },
  order: 0,
}

let executeButton: ReturnType<typeof vi.fn>
let cancelButton: ReturnType<typeof vi.fn>
let viewButtonOutput: ReturnType<typeof vi.fn>

beforeEach(() => {
  executeButton = vi.fn()
  cancelButton = vi.fn()
  viewButtonOutput = vi.fn()
  useButtonStore.setState({
    buttons: [],
    groups: [],
    runningButtons: {},
    executeButton,
    cancelButton,
    viewButtonOutput,
  } as any)
})

describe('CustomButtonRenderer', () => {
  it('renders a button labelled with the custom button label', () => {
    render(<CustomButtonRenderer button={makeButton()} />)
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument()
  })

  it('shows the visible label text in horizontal orientation', () => {
    render(<CustomButtonRenderer button={makeButton()} />)
    expect(screen.getByText('Deploy')).toBeInTheDocument()
  })

  it('hides the label text in vertical orientation but keeps the aria-label', () => {
    render(<CustomButtonRenderer button={makeButton()} orientation="vertical" />)
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument()
  })

  it('renders an emoji icon when the icon is not a known name', () => {
    render(<CustomButtonRenderer button={makeButton({ icon: '🔥' })} />)
    expect(screen.getByText('🔥')).toBeInTheDocument()
  })

  it('clicking executes the button immediately when no confirmation is configured', async () => {
    const user = userEvent.setup()
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(executeButton).toHaveBeenCalledWith('b1')
  })

  it('opens a confirmation dialog instead of executing when confirmMessage is set', async () => {
    const user = userEvent.setup()
    render(
      <CustomButtonRenderer button={makeButton({ confirmMessage: 'Really deploy to prod?' })} />
    )
    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    expect(screen.getByRole('dialog', { name: 'Confirm Action' })).toBeInTheDocument()
    expect(screen.getByText('Really deploy to prod?')).toBeInTheDocument()
    expect(executeButton).not.toHaveBeenCalled()
  })

  it('confirming the dialog executes the button and closes it', async () => {
    const user = userEvent.setup()
    render(<CustomButtonRenderer button={makeButton({ confirmMessage: 'Sure?' })} />)
    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(executeButton).toHaveBeenCalledWith('b1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the dialog closes it without executing', async () => {
    const user = userEvent.setup()
    render(<CustomButtonRenderer button={makeButton({ confirmMessage: 'Sure?' })} />)
    await user.click(screen.getByRole('button', { name: 'Deploy' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(executeButton).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the tooltip with the shortcut on hover', async () => {
    const user = userEvent.setup()
    render(<CustomButtonRenderer button={makeButton({ shortcut: 'Cmd+D' })} />)
    await user.hover(screen.getByRole('button', { name: 'Deploy' }))
    expect(screen.getByText('Deploy (Cmd+D)')).toBeInTheDocument()
  })

  it('tooltip omits the shortcut suffix when none is configured', async () => {
    const user = userEvent.setup()
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.hover(screen.getByRole('button', { name: 'Deploy' }))
    // tooltip text equals the bare label (in addition to the in-button span)
    expect(screen.getAllByText('Deploy').length).toBeGreaterThan(1)
    expect(screen.queryByText(/Deploy \(/)).not.toBeInTheDocument()
  })

  it('a running background button is announced as running', () => {
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    expect(screen.getByRole('button', { name: 'Deploy (running)' })).toBeInTheDocument()
  })

  it('clicking a running background button opens View Output and Cancel options', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.click(screen.getByRole('button', { name: 'Deploy (running)' }))
    expect(screen.getByRole('menuitem', { name: 'View Output' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('omits View Output when the run state has no terminal id', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: '', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.click(screen.getByRole('button', { name: 'Deploy (running)' }))
    expect(screen.queryByRole('menuitem', { name: 'View Output' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('View Output calls viewButtonOutput with the button id', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.click(screen.getByRole('button', { name: 'Deploy (running)' }))
    await user.click(screen.getByRole('menuitem', { name: 'View Output' }))
    expect(viewButtonOutput).toHaveBeenCalledWith('b1')
  })

  it('Cancel calls cancelButton with the button id', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    await user.click(screen.getByRole('button', { name: 'Deploy (running)' }))
    await user.click(screen.getByRole('menuitem', { name: 'Cancel' }))
    expect(cancelButton).toHaveBeenCalledWith('b1')
  })

  it('a running terminal-mode button keeps the plain button (no dropdown)', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton({ executionMode: 'terminal' })} />)
    const button = screen.getByRole('button', { name: 'Deploy' })
    await user.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(executeButton).toHaveBeenCalledWith('b1')
  })

  it('marks a running button with the accent class', () => {
    useButtonStore.setState({
      runningButtons: { b1: { terminalId: 't1', running: true } },
    })
    render(<CustomButtonRenderer button={makeButton()} />)
    expect(screen.getByRole('button', { name: 'Deploy (running)' }).className).toContain(
      'text-accent'
    )
  })
})

describe('ButtonGroupRenderer', () => {
  const groupButtons = [
    makeButton({ id: 'b1', label: 'Lint' }),
    makeButton({ id: 'b2', label: 'Format', confirmMessage: 'Rewrite all files?' }),
  ]

  it('renders the group trigger with its label', () => {
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
  })

  it('hides the visible group label in vertical orientation', () => {
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} orientation="vertical" />)
    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tools' })).toBeInTheDocument()
  })

  it('opens a menu listing every button in the group', async () => {
    const user = userEvent.setup()
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.getByRole('menuitem', { name: 'Lint' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Format' })).toBeInTheDocument()
  })

  it('clicking a non-confirm item executes it directly', async () => {
    const user = userEvent.setup()
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: 'Lint' }))
    expect(executeButton).toHaveBeenCalledWith('b1')
  })

  it('clicking a confirm item opens the dialog first, then executes on Confirm', async () => {
    const user = userEvent.setup()
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: 'Format' }))
    expect(executeButton).not.toHaveBeenCalled()
    expect(screen.getByText('Rewrite all files?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(executeButton).toHaveBeenCalledWith('b2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cancelling the group confirm dialog does not execute', async () => {
    const user = userEvent.setup()
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: 'Format' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(executeButton).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('marks the group trigger with the accent class when any member is running', () => {
    useButtonStore.setState({
      runningButtons: { b2: { terminalId: 't9', running: true } },
    })
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    expect(screen.getByRole('button', { name: 'Tools' }).className).toContain('text-accent')
  })

  it('does not use the accent class when nothing is running', () => {
    render(<ButtonGroupRenderer group={group} buttons={groupButtons} />)
    expect(screen.getByRole('button', { name: 'Tools' }).className).not.toContain('text-accent')
  })
})

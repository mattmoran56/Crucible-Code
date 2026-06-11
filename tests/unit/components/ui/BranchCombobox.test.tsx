import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchCombobox } from '../../../../src/renderer/components/ui/BranchCombobox'

const branches = ['main', 'develop', 'feature/login', 'feature/logout', 'hotfix/crash']

function setup(overrides: Partial<React.ComponentProps<typeof BranchCombobox>> = {}) {
  const onChange = vi.fn()
  const onSelect = vi.fn()
  const utils = render(
    <BranchCombobox
      label="Base branch"
      value=""
      onChange={onChange}
      onSelect={onSelect}
      branches={branches}
      {...overrides}
    />
  )
  return { onChange, onSelect, ...utils }
}

describe('BranchCombobox', () => {
  it('associates the label with the input', () => {
    setup()
    expect(screen.getByLabelText('Base branch')).toBeInTheDocument()
  })

  it('exposes the input with role combobox, collapsed by default', () => {
    setup()
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders the placeholder', () => {
    setup({ placeholder: 'Pick a branch' })
    expect(screen.getByPlaceholderText('Pick a branch')).toBeInTheDocument()
  })

  it('shows a hint linked via aria-describedby', () => {
    setup({ hint: 'Defaults to main' })
    const input = screen.getByRole('combobox')
    const hint = screen.getByText('Defaults to main')
    expect(input).toHaveAttribute('aria-describedby', hint.id)
  })

  it('shows an error instead of the hint and marks the input invalid', () => {
    setup({ hint: 'Defaults to main', error: 'Branch not found' })
    expect(screen.getByText('Branch not found')).toBeInTheDocument()
    expect(screen.queryByText('Defaults to main')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
  })

  it('has no description paragraph when neither hint nor error provided', () => {
    setup()
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-describedby')
  })

  it('focusing the input opens the listbox with all branches', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option')).toHaveLength(branches.length)
  })

  it('filters the options case-insensitively by the current value', async () => {
    const user = userEvent.setup()
    setup({ value: 'FEATURE' })
    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['feature/login', 'feature/logout'])
  })

  it('shows "No matching branches" when nothing matches', async () => {
    const user = userEvent.setup()
    setup({ value: 'zzz-nope' })
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('No matching branches')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('shows "Loading branches..." while loading', async () => {
    const user = userEvent.setup()
    setup({ loading: true })
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('Loading branches...')).toBeInTheDocument()
  })

  it('typing calls onChange with the new value', async () => {
    const user = userEvent.setup()
    const { onChange } = setup()
    await user.type(screen.getByRole('combobox'), 'm')
    expect(onChange).toHaveBeenCalledWith('m')
  })

  it('the first option is highlighted (aria-selected) when opened', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[1]).toHaveAttribute('aria-selected', 'false')
  })

  it('sets aria-activedescendant to the highlighted option id when open', async () => {
    const user = userEvent.setup()
    setup()
    const input = screen.getByRole('combobox')
    await user.click(input)
    const options = screen.getAllByRole('option')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)
  })

  it('has no aria-activedescendant while closed', () => {
    setup()
    expect(screen.getByRole('combobox')).not.toHaveAttribute('aria-activedescendant')
  })

  it('ArrowDown opens the dropdown when it is closed', async () => {
    const user = userEvent.setup()
    setup()
    const input = screen.getByRole('combobox')
    // focus opens it; close again with Escape to test the closed branch
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-expanded', 'true')
  })

  it('ArrowDown moves the highlight to the next option', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}')
    const options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('ArrowDown clamps the highlight at the last option', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    for (let i = 0; i < branches.length + 3; i++) {
      await user.keyboard('{ArrowDown}')
    }
    const options = screen.getAllByRole('option')
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true')
  })

  it('ArrowUp moves the highlight back and clamps at the first option', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')
    let options = screen.getAllByRole('option')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
    options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('Enter selects the highlighted branch and closes the dropdown', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onSelect).toHaveBeenCalledWith('develop')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
  })

  it('Enter does nothing when the filtered list is empty', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup({ value: 'zzz-nope' })
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('Escape closes the dropdown', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clicking an option selects it and keeps focus on the input', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup()
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.click(screen.getByRole('option', { name: 'hotfix/crash' }))
    expect(onSelect).toHaveBeenCalledWith('hotfix/crash')
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('hovering an option moves the highlight to it', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    await user.hover(screen.getByRole('option', { name: 'main' }))
    expect(screen.getByRole('option', { name: 'main' })).toHaveAttribute('aria-selected', 'true')
  })

  it('a mousedown outside closes the dropdown', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('autoFocus focuses the input on mount', () => {
    setup({ autoFocus: true })
    expect(screen.getByRole('combobox')).toHaveFocus()
  })

  it('renders the dropdown in a portal attached to document.body', async () => {
    const user = userEvent.setup()
    const { container } = setup()
    await user.click(screen.getByRole('combobox'))
    const listbox = screen.getByRole('listbox')
    expect(container).not.toContainElement(listbox)
    expect(document.body).toContainElement(listbox)
  })
})

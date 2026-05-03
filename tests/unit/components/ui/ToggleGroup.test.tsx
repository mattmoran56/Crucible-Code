import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToggleGroup } from '../../../../src/renderer/components/ui/ToggleGroup'

const opts = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const

describe('ToggleGroup', () => {
  it('renders one radio per option with the right names', () => {
    render(<ToggleGroup options={[...opts]} value="off" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Off' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'On' })).toBeInTheDocument()
  })

  it('marks the active option with aria-checked=true', () => {
    render(<ToggleGroup options={[...opts]} value="on" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
  })

  it('exposes itself as a radiogroup', () => {
    render(<ToggleGroup options={[...opts]} value="off" onChange={() => {}} />)
    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
  })

  it('fires onChange with the option value when clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ToggleGroup options={[...opts]} value="off" onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: 'On' }))
    expect(onChange).toHaveBeenCalledWith('on')
  })
})

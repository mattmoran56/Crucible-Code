import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '../../../../src/renderer/components/ui/Input'

describe('Input', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(<Input label="Email" />)
    const input = screen.getByLabelText('Email')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
  })

  it('shows hint text under the input', () => {
    render(<Input label="Branch" hint="The branch to base from" />)
    expect(screen.getByText('The branch to base from')).toBeInTheDocument()
  })

  it('prefers error over hint when both are present', () => {
    render(<Input label="Branch" hint="some hint" error="That branch already exists" />)
    expect(screen.getByText('That branch already exists')).toBeInTheDocument()
    expect(screen.queryByText('some hint')).not.toBeInTheDocument()
  })

  it('marks the input as invalid when error is set', () => {
    render(<Input label="Branch" error="bad" />)
    expect(screen.getByLabelText('Branch')).toHaveAttribute('aria-invalid', 'true')
  })

  it('forwards onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Input label="Branch" onChange={onChange} />)
    await user.type(screen.getByLabelText('Branch'), 'feat')
    expect(onChange).toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SuggestionBlock } from '../../../../src/renderer/components/pullrequests/SuggestionBlock'

describe('SuggestionBlock', () => {
  it('renders "Line N" for a single-line suggestion', () => {
    render(<SuggestionBlock text="hello" author="alice" startLine={4} endLine={4} />)
    expect(screen.getByText(/Line 4/)).toBeInTheDocument()
  })

  it('renders "Lines N–M" for a multi-line suggestion', () => {
    render(<SuggestionBlock text="a\nb\nc" author="alice" startLine={2} endLine={5} />)
    expect(screen.getByText(/Lines 2–5/)).toBeInTheDocument()
  })

  it('Apply suggestion is disabled when no onApply prop is provided', () => {
    render(<SuggestionBlock text="x" author="a" startLine={1} endLine={1} />)
    expect(screen.getByRole('button', { name: 'Apply suggestion' })).toBeDisabled()
  })

  it('clicking Apply forwards startLine, endLine, text, and author to onApply', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(
      <SuggestionBlock text="hello" author="bob" startLine={1} endLine={2} onApply={onApply} />
    )
    await user.click(screen.getByRole('button', { name: 'Apply suggestion' }))
    expect(onApply).toHaveBeenCalledWith(1, 2, 'hello', 'bob')
  })

  it('renders each line of the suggestion with a leading + marker', () => {
    render(<SuggestionBlock text={'first\nsecond'} author="a" startLine={1} endLine={2} />)
    const pluses = screen.getAllByText('+')
    expect(pluses.length).toBe(2)
  })
})

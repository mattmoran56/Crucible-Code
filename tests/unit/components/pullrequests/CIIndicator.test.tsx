import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CIIndicator } from '../../../../src/renderer/components/pullrequests/CIIndicator'

describe('CIIndicator', () => {
  it('renders nothing for "none"', () => {
    const { container } = render(<CIIndicator status={'none' as any} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the success icon with the right aria-label', () => {
    render(<CIIndicator status={'success' as any} />)
    expect(screen.getByLabelText('CI passed')).toBeInTheDocument()
  })

  it('shows the failure icon with the right aria-label', () => {
    render(<CIIndicator status={'failure' as any} />)
    expect(screen.getByLabelText('CI failed')).toBeInTheDocument()
  })

  it('shows the spinner for any other status (e.g. pending)', () => {
    render(<CIIndicator status={'pending' as any} />)
    expect(screen.getByLabelText('CI running')).toBeInTheDocument()
  })
})

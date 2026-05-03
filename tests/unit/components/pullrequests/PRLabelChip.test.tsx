import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PRLabelChip } from '../../../../src/renderer/components/pullrequests/PRLabelChip'

describe('PRLabelChip', () => {
  it('renders the label name', () => {
    render(<PRLabelChip label={{ name: 'bug', color: 'ff0000', description: '' } as any} />)
    expect(screen.getByText('bug')).toBeInTheDocument()
  })

  it('uses the label colour as background', () => {
    render(<PRLabelChip label={{ name: 'feat', color: '00ff00', description: '' } as any} />)
    const span = screen.getByText('feat').parentElement!
    expect(span.style.background).toMatch(/#00ff00|rgb\(0, 255, 0\)/)
  })

  it('chooses black text on light backgrounds', () => {
    render(<PRLabelChip label={{ name: 'x', color: 'ffffff', description: '' } as any} />)
    const span = screen.getByText('x').parentElement!
    expect(span.style.color).toMatch(/#000000|rgb\(0, 0, 0\)/)
  })

  it('chooses white text on dark backgrounds', () => {
    render(<PRLabelChip label={{ name: 'x', color: '000000', description: '' } as any} />)
    const span = screen.getByText('x').parentElement!
    expect(span.style.color).toMatch(/#ffffff|rgb\(255, 255, 255\)/)
  })

  it('uses the description in the title attribute when present', () => {
    render(
      <PRLabelChip
        label={{ name: 'enhancement', color: 'cccccc', description: 'a polish task' } as any}
      />
    )
    const span = screen.getByText('enhancement').parentElement!
    expect(span).toHaveAttribute('title', 'enhancement — a polish task')
  })

  it('falls back to default color when missing', () => {
    render(<PRLabelChip label={{ name: 'x', color: '', description: '' } as any} />)
    const span = screen.getByText('x').parentElement!
    // Should not throw, should produce a valid background
    expect(span.style.background).toBeTruthy()
  })

  it('expands 3-digit hex colors', () => {
    render(<PRLabelChip label={{ name: 'x', color: 'fff', description: '' } as any} />)
    const span = screen.getByText('x').parentElement!
    expect(span.style.color).toMatch(/#000000|rgb\(0, 0, 0\)/)
  })
})

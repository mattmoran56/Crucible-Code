import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Avatar } from '../../../../src/renderer/components/ui/Avatar'

describe('Avatar', () => {
  it('renders the first two letters of the login uppercased', () => {
    render(<Avatar login="alice" />)
    expect(screen.getByText('AL')).toBeInTheDocument()
  })

  it('uses the login as the title by default', () => {
    render(<Avatar login="bob" />)
    expect(screen.getByText('BO')).toHaveAttribute('title', 'bob')
  })

  it('honours an explicit title prop', () => {
    render(<Avatar login="bob" title="Bob the Builder" />)
    expect(screen.getByText('BO')).toHaveAttribute('title', 'Bob the Builder')
  })

  it('uses the size prop for width/height/font sizing', () => {
    render(<Avatar login="al" size={40} />)
    const el = screen.getByText('AL')
    expect(el.style.width).toBe('40px')
    expect(el.style.height).toBe('40px')
    expect(el.style.fontSize).toBe('20px')
  })

  it('floors fontSize at 8px even for tiny avatars', () => {
    render(<Avatar login="al" size={4} />)
    expect(screen.getByText('AL').style.fontSize).toBe('8px')
  })

  it('appends ringClassName onto the className', () => {
    render(<Avatar login="al" ringClassName="ring-2" />)
    expect(screen.getByText('AL').className).toMatch(/ring-2/)
  })
})

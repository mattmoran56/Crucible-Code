import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BUTTON_ICONS,
  ICON_NAMES,
  IconPicker,
  renderButtonIcon,
} from '../../../../src/renderer/components/buttons/IconPicker'

describe('IconPicker', () => {
  it('renders the icon search input', () => {
    render(<IconPicker value={undefined} onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Search icons...')).toBeInTheDocument()
  })

  it('renders one button per curated icon', () => {
    render(<IconPicker value={undefined} onChange={() => {}} />)
    for (const name of ICON_NAMES) {
      expect(screen.getByTitle(name)).toBeInTheDocument()
    }
    // grid buttons + the emoji "Use" button
    expect(screen.getAllByRole('button')).toHaveLength(ICON_NAMES.length + 1)
  })

  it('filters icons by the search text', async () => {
    const user = userEvent.setup()
    render(<IconPicker value={undefined} onChange={() => {}} />)
    await user.type(screen.getByPlaceholderText('Search icons...'), 'cl')
    expect(screen.getByTitle('Clock')).toBeInTheDocument()
    expect(screen.getByTitle('Cloud')).toBeInTheDocument()
    expect(screen.queryByTitle('Play')).not.toBeInTheDocument()
  })

  it('search is case-insensitive', async () => {
    const user = userEvent.setup()
    render(<IconPicker value={undefined} onChange={() => {}} />)
    await user.type(screen.getByPlaceholderText('Search icons...'), 'GITBRANCH')
    expect(screen.getByTitle('GitBranch')).toBeInTheDocument()
  })

  it('shows no icon buttons when the search matches nothing', async () => {
    const user = userEvent.setup()
    render(<IconPicker value={undefined} onChange={() => {}} />)
    await user.type(screen.getByPlaceholderText('Search icons...'), 'zzz')
    // only the emoji Use button remains
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('clearing the search restores the full grid', async () => {
    const user = userEvent.setup()
    render(<IconPicker value={undefined} onChange={() => {}} />)
    const search = screen.getByPlaceholderText('Search icons...')
    await user.type(search, 'zzz')
    await user.clear(search)
    expect(screen.getAllByRole('button')).toHaveLength(ICON_NAMES.length + 1)
  })

  it('clicking an icon calls onChange with its name', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={undefined} onChange={onChange} />)
    await user.click(screen.getByTitle('Rocket'))
    expect(onChange).toHaveBeenCalledWith('Rocket')
  })

  it('highlights the currently selected icon', () => {
    render(<IconPicker value="Zap" onChange={() => {}} />)
    expect(screen.getByTitle('Zap').className).toContain('bg-accent/20')
    expect(screen.getByTitle('Play').className).not.toContain('bg-accent/20')
  })

  it('renders the emoji input', () => {
    render(<IconPicker value={undefined} onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Or type emoji...')).toBeInTheDocument()
  })

  it('Use submits the emoji and clears the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={undefined} onChange={onChange} />)
    const emoji = screen.getByPlaceholderText('Or type emoji...') as HTMLInputElement
    await user.type(emoji, '🚀')
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(onChange).toHaveBeenCalledWith('🚀')
    expect(emoji.value).toBe('')
  })

  it('Use trims surrounding whitespace from the emoji', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={undefined} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText('Or type emoji...'), '  ⚡  ')
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(onChange).toHaveBeenCalledWith('⚡')
  })

  it('Use does nothing when the emoji input is empty', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={undefined} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Use does nothing for whitespace-only emoji input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<IconPicker value={undefined} onChange={onChange} />)
    await user.type(screen.getByPlaceholderText('Or type emoji...'), '   ')
    await user.click(screen.getByRole('button', { name: 'Use' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('renderButtonIcon', () => {
  it('falls back to the Play icon when no icon is set', () => {
    const { container } = render(<>{renderButtonIcon(undefined)}</>)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.querySelector('polygon')).toHaveAttribute('points', '6 3 20 12 6 21 6 3')
  })

  it('renders a known icon name as an svg of the requested size', () => {
    const { container } = render(<>{renderButtonIcon('Square', 20)}</>)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveAttribute('height', '20')
    expect(svg.querySelector('rect')).not.toBeNull()
  })

  it('defaults the size to 16', () => {
    const { container } = render(<>{renderButtonIcon('Check')}</>)
    expect(container.querySelector('svg')).toHaveAttribute('width', '16')
  })

  it('renders an unknown icon string as an emoji span', () => {
    const { container } = render(<>{renderButtonIcon('🔥', 18)}</>)
    expect(container.querySelector('svg')).toBeNull()
    const span = container.querySelector('span')!
    expect(span.textContent).toBe('🔥')
    expect(span.style.fontSize).toBe('18px')
  })
})

describe('BUTTON_ICONS / ICON_NAMES', () => {
  it('ICON_NAMES mirrors the keys of BUTTON_ICONS', () => {
    expect(ICON_NAMES).toEqual(Object.keys(BUTTON_ICONS))
  })

  it('includes the expected staple icons', () => {
    expect(ICON_NAMES).toEqual(
      expect.arrayContaining(['Play', 'Terminal', 'Rocket', 'GitBranch', 'Settings'])
    )
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { LoadingScreen } from '../../../src/renderer/components/LoadingScreen'

// The component picks the initial phrase with Math.random; pin it so the
// rotation sequence is deterministic. PHRASES[0] is 'Spawning agents…'.
const FIRST_PHRASE = 'Spawning agents…'
const SECOND_PHRASE = 'Bribing the compiler…'
const THIRD_PHRASE = 'Convincing the LLM…'
const LAST_PHRASE = 'Famous last words…'

describe('LoadingScreen', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the app name', () => {
    render(<LoadingScreen visible />)
    expect(screen.getByText('Crucible Code')).toBeInTheDocument()
  })

  it('renders the uppercase tagline', () => {
    render(<LoadingScreen visible />)
    expect(screen.getByText('Agentic Development')).toBeInTheDocument()
  })

  it('renders the CC monogram inside the logo svg', () => {
    render(<LoadingScreen visible />)
    const monogram = screen.getByText('CC')
    expect(monogram.tagName.toLowerCase()).toBe('text')
  })

  it('is fully opaque and interactive while visible', () => {
    const { container } = render(<LoadingScreen visible />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('1')
    expect(overlay.style.pointerEvents).toBe('auto')
  })

  it('shows the first phrase when Math.random returns 0', () => {
    render(<LoadingScreen visible />)
    expect(screen.getByText(FIRST_PHRASE)).toBeInTheDocument()
  })

  it('shows the last phrase when Math.random is just under 1', () => {
    ;(Math.random as ReturnType<typeof vi.fn>).mockReturnValue(0.999999)
    render(<LoadingScreen visible />)
    expect(screen.getByText(LAST_PHRASE)).toBeInTheDocument()
  })

  it('fades out when visible flips to false', () => {
    const { container, rerender } = render(<LoadingScreen visible />)
    rerender(<LoadingScreen visible={false} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('0')
  })

  it('disables pointer events once faded out', () => {
    const { container, rerender } = render(<LoadingScreen visible />)
    rerender(<LoadingScreen visible={false} />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.pointerEvents).toBe('none')
  })

  it('stays mounted (parent handles unmount) after visibility goes false', () => {
    const { rerender } = render(<LoadingScreen visible />)
    rerender(<LoadingScreen visible={false} />)
    expect(screen.getByText('Crucible Code')).toBeInTheDocument()
  })

  it('remains opaque when re-rendered with visible still true', () => {
    const { container, rerender } = render(<LoadingScreen visible />)
    rerender(<LoadingScreen visible />)
    const overlay = container.firstChild as HTMLElement
    expect(overlay.style.opacity).toBe('1')
  })

  it('hides the phrase during the swap window of a rotation tick', () => {
    vi.useFakeTimers()
    render(<LoadingScreen visible />)
    act(() => {
      vi.advanceTimersByTime(1800)
    })
    // interval fired but the 200ms swap timeout has not: old phrase, opacity 0
    const phrase = screen.getByText(FIRST_PHRASE)
    expect(phrase.style.opacity).toBe('0')
  })

  it('advances to the next phrase after a full rotation tick', () => {
    vi.useFakeTimers()
    render(<LoadingScreen visible />)
    act(() => {
      vi.advanceTimersByTime(1800 + 200)
    })
    const phrase = screen.getByText(SECOND_PHRASE)
    expect(phrase.style.opacity).toBe('1')
  })

  it('advances two phrases after two rotation ticks', () => {
    vi.useFakeTimers()
    render(<LoadingScreen visible />)
    act(() => {
      vi.advanceTimersByTime(2 * 1800 + 200)
    })
    expect(screen.getByText(THIRD_PHRASE)).toBeInTheDocument()
  })

  it('wraps around to the first phrase after the last one', () => {
    ;(Math.random as ReturnType<typeof vi.fn>).mockReturnValue(0.999999)
    vi.useFakeTimers()
    render(<LoadingScreen visible />)
    expect(screen.getByText(LAST_PHRASE)).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1800 + 200)
    })
    expect(screen.getByText(FIRST_PHRASE)).toBeInTheDocument()
  })

  it('clears its rotation interval on unmount', () => {
    vi.useFakeTimers()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = render(<LoadingScreen visible />)
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    // advancing time after unmount must not throw or warn
    act(() => {
      vi.advanceTimersByTime(5000)
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiffErrorBoundary } from '../../../../src/renderer/components/ui/DiffErrorBoundary'

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('boom')
  return <div>safe content</div>
}

let consoleSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  // React logs caught errors via console.error; suppress for cleaner output
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  consoleSpy.mockRestore()
})

describe('DiffErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <DiffErrorBoundary>
        <Boom explode={false} />
      </DiffErrorBoundary>
    )
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('catches a render error and shows the fallback', () => {
    render(
      <DiffErrorBoundary>
        <Boom explode={true} />
      </DiffErrorBoundary>
    )
    expect(screen.getByText('Failed to render diff')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the filePath in the fallback when provided', () => {
    render(
      <DiffErrorBoundary filePath="src/foo.ts">
        <Boom explode={true} />
      </DiffErrorBoundary>
    )
    expect(screen.getByText('src/foo.ts')).toBeInTheDocument()
  })

  it('Retry resets the boundary so the next render is shown', async () => {
    const user = userEvent.setup()
    let shouldThrow = true
    function Toggling() {
      if (shouldThrow) throw new Error('boom')
      return <div>safe content</div>
    }
    render(
      <DiffErrorBoundary>
        <Toggling />
      </DiffErrorBoundary>
    )
    expect(screen.getByText('Failed to render diff')).toBeInTheDocument()
    shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })
})

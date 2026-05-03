import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LargeFileWarning } from '../../../../src/renderer/components/ui/LargeFileWarning'

describe('LargeFileWarning', () => {
  it('renders the file name and size in MB', () => {
    render(
      <LargeFileWarning fileName="big.json" fileSize={2 * 1024 * 1024} onOpen={() => {}} onCancel={() => {}} />
    )
    expect(screen.getByText('big.json')).toBeInTheDocument()
    expect(screen.getByText(/is 2\.0MB/)).toBeInTheDocument()
  })

  it('rounds size to one decimal place', () => {
    render(
      <LargeFileWarning fileName="x" fileSize={1.55 * 1024 * 1024} onOpen={() => {}} onCancel={() => {}} />
    )
    expect(screen.getByText(/is 1\.6MB/)).toBeInTheDocument()
  })

  it('Cancel triggers onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <LargeFileWarning fileName="x" fileSize={1024 * 1024} onOpen={() => {}} onCancel={onCancel} />
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('Open Anyway triggers onOpen', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(
      <LargeFileWarning fileName="x" fileSize={1024 * 1024} onOpen={onOpen} onCancel={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: 'Open Anyway' }))
    expect(onOpen).toHaveBeenCalled()
  })
})

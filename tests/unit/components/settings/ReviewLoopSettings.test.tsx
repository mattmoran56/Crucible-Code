import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReviewLoopSettings } from '../../../../src/renderer/components/settings/ReviewLoopSettings'
import { useReviewLoopStore } from '../../../../src/renderer/stores/reviewLoopStore'
import { useToastStore } from '../../../../src/renderer/stores/toastStore'
import { DEFAULT_REVIEW_LOOP_CONFIG, type Project } from '../../../../src/shared/types'

const projectA: Project = { id: 'proj-a', name: 'Alpha', repoPath: '/repos/alpha' }
const projectB: Project = { id: 'proj-b', name: 'Beta', repoPath: '/repos/beta' }

let setSettingsMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  setSettingsMock = vi.fn(async () => {})
  ;(window as any).api = {
    reviewLoop: { setSettings: setSettingsMock },
  }
  useReviewLoopStore.setState({
    settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG }, projectOverrides: {} },
    loaded: true,
    states: {},
  })
  useToastStore.setState({ toasts: [] })
})

function card(title: string): HTMLElement {
  return screen.getByText(title).closest('.rounded-md') as HTMLElement
}

describe('ReviewLoopSettings', () => {
  it('renders the heading and intro copy', () => {
    render(<ReviewLoopSettings projects={[]} />)
    expect(screen.getByRole('heading', { name: 'Review Loop' })).toBeInTheDocument()
    expect(screen.getByText(/Automate the review → triage → fix cycle/)).toBeInTheDocument()
  })

  it('always renders the workspace defaults card', () => {
    render(<ReviewLoopSettings projects={[]} />)
    expect(screen.getByText('Workspace defaults')).toBeInTheDocument()
    expect(screen.getByText("Used by every project that hasn't set its own values.")).toBeInTheDocument()
  })

  it('renders a card per project with name and repo path', () => {
    render(<ReviewLoopSettings projects={[projectA, projectB]} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('/repos/alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('/repos/beta')).toBeInTheDocument()
  })

  it('shows On as checked when the workspace loop is enabled', () => {
    render(<ReviewLoopSettings projects={[]} />)
    const ws = card('Workspace defaults')
    expect(within(ws).getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
    expect(within(ws).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
  })

  it('turning the workspace loop Off updates the store and persists', async () => {
    const user = userEvent.setup()
    render(<ReviewLoopSettings projects={[]} />)
    await user.click(within(card('Workspace defaults')).getByRole('radio', { name: 'Off' }))
    expect(useReviewLoopStore.getState().settings.workspace.enabled).toBe(false)
    expect(setSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: expect.objectContaining({ enabled: false }),
      })
    )
  })

  it('switching the workspace variant to Pro persists variant pro', async () => {
    const user = userEvent.setup()
    render(<ReviewLoopSettings projects={[]} />)
    await user.click(within(card('Workspace defaults')).getByRole('radio', { name: 'Pro' }))
    expect(useReviewLoopStore.getState().settings.workspace.variant).toBe('pro')
  })

  it('shows the two numeric stop-condition fields with defaults', () => {
    render(<ReviewLoopSettings projects={[]} />)
    const ws = card('Workspace defaults')
    expect(within(ws).getByLabelText(/Max iterations/)).toHaveValue(5)
    expect(within(ws).getByLabelText(/Clean rounds to stop/)).toHaveValue(2)
  })

  it('number inputs carry their min/max constraints', () => {
    render(<ReviewLoopSettings projects={[]} />)
    const ws = card('Workspace defaults')
    const maxIter = within(ws).getByLabelText(/Max iterations/)
    expect(maxIter).toHaveAttribute('min', '1')
    expect(maxIter).toHaveAttribute('max', '20')
    const cleanRounds = within(ws).getByLabelText(/Clean rounds to stop/)
    expect(cleanRounds).toHaveAttribute('min', '1')
    expect(cleanRounds).toHaveAttribute('max', '5')
  })

  it('changing workspace max iterations updates the store', () => {
    render(<ReviewLoopSettings projects={[]} />)
    const input = within(card('Workspace defaults')).getByLabelText(/Max iterations/)
    fireEvent.change(input, { target: { value: '9' } })
    expect(useReviewLoopStore.getState().settings.workspace.maxIterations).toBe(9)
  })

  it('changing a project value stores only the delta as an override', () => {
    render(<ReviewLoopSettings projects={[projectA]} />)
    const input = within(card('Alpha')).getByLabelText(/Max iterations/)
    fireEvent.change(input, { target: { value: '7' } })
    expect(useReviewLoopStore.getState().settings.projectOverrides['proj-a']).toEqual({
      maxIterations: 7,
    })
  })

  it('project cards inherit workspace values when no override exists', () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, maxIterations: 12 },
        projectOverrides: {},
      },
    })
    render(<ReviewLoopSettings projects={[projectA]} />)
    expect(within(card('Alpha')).getByLabelText(/Max iterations/)).toHaveValue(12)
  })

  it('shows the Customized badge only on overridden project cards', () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { 'proj-a': { variant: 'pro' } },
      },
    })
    render(<ReviewLoopSettings projects={[projectA, projectB]} />)
    expect(within(card('Alpha')).getByText('Customized')).toBeInTheDocument()
    expect(within(card('Beta')).queryByText('Customized')).not.toBeInTheDocument()
  })

  it('an overridden project card shows the merged effective config', () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, variant: 'lite' },
        projectOverrides: { 'proj-a': { variant: 'pro', consecutiveCleanRounds: 4 } },
      },
    })
    render(<ReviewLoopSettings projects={[projectA]} />)
    const alpha = card('Alpha')
    expect(within(alpha).getByRole('radio', { name: 'Pro' })).toHaveAttribute('aria-checked', 'true')
    expect(within(alpha).getByLabelText(/Clean rounds to stop/)).toHaveValue(4)
    // Workspace card is unaffected by the project override.
    const ws = card('Workspace defaults')
    expect(within(ws).getByRole('radio', { name: 'Lite' })).toHaveAttribute('aria-checked', 'true')
  })

  it('the Reset to default button only appears on customized cards', () => {
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { 'proj-a': { enabled: false } },
      },
    })
    render(<ReviewLoopSettings projects={[projectA, projectB]} />)
    expect(within(card('Alpha')).getByRole('button', { name: 'Reset to default' })).toBeInTheDocument()
    expect(within(card('Beta')).queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument()
    expect(
      within(card('Workspace defaults')).queryByRole('button', { name: 'Reset to default' })
    ).not.toBeInTheDocument()
  })

  it('clicking Reset to default clears the project override', async () => {
    const user = userEvent.setup()
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { 'proj-a': { enabled: false, variant: 'pro' } },
      },
    })
    render(<ReviewLoopSettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('button', { name: 'Reset to default' }))
    expect(useReviewLoopStore.getState().settings.projectOverrides['proj-a']).toBeUndefined()
    expect(setSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectOverrides: {} })
    )
  })

  it('setting a project value back to the workspace value collapses the override', async () => {
    const user = userEvent.setup()
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG, variant: 'lite' },
        projectOverrides: { 'proj-a': { variant: 'pro' } },
      },
    })
    render(<ReviewLoopSettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('radio', { name: 'Lite' }))
    expect(useReviewLoopStore.getState().settings.projectOverrides['proj-a']).toBeUndefined()
    expect(screen.queryByText('Customized')).not.toBeInTheDocument()
  })

  it('disabling the loop for one project leaves the workspace config untouched', async () => {
    const user = userEvent.setup()
    render(<ReviewLoopSettings projects={[projectA]} />)
    await user.click(within(card('Alpha')).getByRole('radio', { name: 'Off' }))
    const { settings } = useReviewLoopStore.getState()
    expect(settings.workspace.enabled).toBe(true)
    expect(settings.projectOverrides['proj-a']).toEqual({ enabled: false })
  })

  it('changing multiple project fields accumulates all deltas in the override', async () => {
    const user = userEvent.setup()
    render(<ReviewLoopSettings projects={[projectA]} />)
    const alpha = card('Alpha')
    await user.click(within(alpha).getByRole('radio', { name: 'Pro' }))
    fireEvent.change(within(card('Alpha')).getByLabelText(/Clean rounds to stop/), {
      target: { value: '3' },
    })
    expect(useReviewLoopStore.getState().settings.projectOverrides['proj-a']).toEqual({
      variant: 'pro',
      consecutiveCleanRounds: 3,
    })
  })

  it('renders only the workspace card when the project list is empty', () => {
    render(<ReviewLoopSettings projects={[]} />)
    // One card -> exactly one "Show review loop button" row.
    expect(screen.getAllByText('Show review loop button')).toHaveLength(1)
  })

  it('explains the Lite and Pro variants in the helper text', () => {
    render(<ReviewLoopSettings projects={[]} />)
    expect(screen.getByRole('radio', { name: 'Lite' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Pro' })).toBeInTheDocument()
    expect(screen.getByText(/structured 3-phase pipeline/)).toBeInTheDocument()
  })
})

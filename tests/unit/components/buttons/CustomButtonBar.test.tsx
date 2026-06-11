import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomButtonBar } from '../../../../src/renderer/components/buttons/CustomButtonBar'
import { useButtonStore } from '../../../../src/renderer/stores/buttonStore'
import { useProjectStore } from '../../../../src/renderer/stores/projectStore'
import { useReviewLoopStore } from '../../../../src/renderer/stores/reviewLoopStore'
import {
  DEFAULT_REVIEW_LOOP_CONFIG,
  type CustomButton,
  type CustomButtonGroup,
} from '../../../../src/shared/types'

function makeButton(overrides: Partial<CustomButton> = {}): CustomButton {
  return {
    id: `btn-${Math.random().toString(36).slice(2)}`,
    label: 'Run',
    icon: 'Play',
    placement: 'session-toolbar',
    actionType: 'shell',
    executionMode: 'background',
    command: 'npm test',
    scope: { type: 'global' },
    order: 0,
    ...overrides,
  }
}

function makeGroup(overrides: Partial<CustomButtonGroup> = {}): CustomButtonGroup {
  return {
    id: `grp-${Math.random().toString(36).slice(2)}`,
    label: 'Group',
    icon: 'Wrench',
    placement: 'session-toolbar',
    scope: { type: 'global' },
    order: 0,
    ...overrides,
  }
}

let executeButton: ReturnType<typeof vi.fn>

beforeEach(() => {
  executeButton = vi.fn()
  useButtonStore.setState({
    buttons: [],
    groups: [],
    runningButtons: {},
    executeButton,
  } as any)
  useProjectStore.setState({
    projects: [{ id: 'p1', name: 'Proj', repoPath: '/repo' }],
    activeProjectId: 'p1',
  } as any)
  useReviewLoopStore.setState({
    settings: { workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG }, projectOverrides: {} },
  } as any)
})

describe('CustomButtonBar', () => {
  it('renders nothing when there are no buttons or groups for the placement', () => {
    const { container } = render(<CustomButtonBar placement="session-toolbar" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders session-toolbar buttons inside the toolbar wrapper', () => {
    useButtonStore.setState({ buttons: [makeButton({ id: 'b1', label: 'Build' })] })
    const { container } = render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Build' })).toBeInTheDocument()
    expect(container.querySelector('.border-b')).not.toBeNull()
  })

  it('only shows buttons whose placement matches', () => {
    useButtonStore.setState({
      buttons: [
        makeButton({ id: 'b1', label: 'Toolbar Btn', placement: 'session-toolbar' }),
        makeButton({ id: 'b2', label: 'Tabs Btn', placement: 'project-tabs' }),
      ],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Toolbar Btn' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tabs Btn' })).not.toBeInTheDocument()
  })

  it('shows project-scoped buttons only for the matching active project', () => {
    useButtonStore.setState({
      buttons: [
        makeButton({ id: 'b1', label: 'Mine', scope: { type: 'projects', projectIds: ['p1'] } }),
        makeButton({ id: 'b2', label: 'Other', scope: { type: 'projects', projectIds: ['p2'] } }),
      ],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
  })

  it('hides all-projects buttons when no project is active', () => {
    useProjectStore.setState({ activeProjectId: null } as any)
    useButtonStore.setState({
      buttons: [makeButton({ id: 'b1', label: 'AllProj', scope: { type: 'all-projects' } })],
    })
    const { container } = render(<CustomButtonBar placement="session-toolbar" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows global buttons even when no project is active', () => {
    useProjectStore.setState({ activeProjectId: null } as any)
    useButtonStore.setState({
      buttons: [makeButton({ id: 'b1', label: 'Global', scope: { type: 'global' } })],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Global' })).toBeInTheDocument()
  })

  it('orders buttons by their order field', () => {
    useButtonStore.setState({
      buttons: [
        makeButton({ id: 'b1', label: 'Second', order: 5 }),
        makeButton({ id: 'b2', label: 'First', order: 1 }),
      ],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['First', 'Second'])
  })

  it('interleaves groups and ungrouped buttons by order', () => {
    const grp = makeGroup({ id: 'g1', label: 'Tools', order: 2 })
    useButtonStore.setState({
      buttons: [
        makeButton({ id: 'b1', label: 'Solo', order: 5 }),
        makeButton({ id: 'b2', label: 'Member', order: 0, groupId: 'g1' }),
      ],
      groups: [grp],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Tools', 'Solo'])
  })

  it('group menu lists its member buttons and executes them', async () => {
    const user = userEvent.setup()
    const grp = makeGroup({ id: 'g1', label: 'Tools' })
    useButtonStore.setState({
      buttons: [makeButton({ id: 'b2', label: 'Member', groupId: 'g1' })],
      groups: [grp],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    await user.click(screen.getByRole('button', { name: 'Tools' }))
    await user.click(screen.getByRole('menuitem', { name: 'Member' }))
    expect(executeButton).toHaveBeenCalledWith('b2')
  })

  it('clicking a rendered button delegates to executeButton', async () => {
    const user = userEvent.setup()
    useButtonStore.setState({ buttons: [makeButton({ id: 'b1', label: 'Build' })] })
    render(<CustomButtonBar placement="session-toolbar" />)
    await user.click(screen.getByRole('button', { name: 'Build' }))
    expect(executeButton).toHaveBeenCalledWith('b1')
  })

  it('renders a divider plus vertical buttons for the right activity bar', () => {
    useButtonStore.setState({
      buttons: [makeButton({ id: 'b1', label: 'Deploy', placement: 'right-activity-bar' })],
    })
    const { container } = render(<CustomButtonBar placement="right-activity-bar" />)
    expect(container.querySelector('.bg-border')).not.toBeNull()
    // vertical orientation: aria-label only, no visible text
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument()
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument()
  })

  it('renders project-tabs buttons inline without the toolbar wrapper', () => {
    useButtonStore.setState({
      buttons: [makeButton({ id: 'b1', label: 'Tab Btn', placement: 'project-tabs' })],
    })
    const { container } = render(<CustomButtonBar placement="project-tabs" />)
    expect(screen.getByRole('button', { name: 'Tab Btn' })).toBeInTheDocument()
    expect(screen.getByText('Tab Btn')).toBeInTheDocument()
    expect(container.querySelector('.border-b')).toBeNull()
  })

  it('hides the built-in review-loop button when the loop is disabled for the project', () => {
    useButtonStore.setState({
      buttons: [
        makeButton({ id: 'built-in:review-loop:start', label: 'Review Loop' }),
        makeButton({ id: 'b1', label: 'Other' }),
      ],
    })
    useReviewLoopStore.setState({
      settings: {
        workspace: { ...DEFAULT_REVIEW_LOOP_CONFIG },
        projectOverrides: { p1: { enabled: false } },
      },
    } as any)
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.queryByRole('button', { name: 'Review Loop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Other' })).toBeInTheDocument()
  })

  it('shows the built-in review-loop button when the loop is enabled', () => {
    useButtonStore.setState({
      buttons: [makeButton({ id: 'built-in:review-loop:start', label: 'Review Loop' })],
    })
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Review Loop' })).toBeInTheDocument()
  })

  it('still renders a group trigger when the group has no member buttons', () => {
    // current behavior: an empty group keeps its trigger (menu just has no items)
    useButtonStore.setState({ groups: [makeGroup({ id: 'g1', label: 'Empty Group' })] })
    render(<CustomButtonBar placement="session-toolbar" />)
    expect(screen.getByRole('button', { name: 'Empty Group' })).toBeInTheDocument()
  })

  it('a group scoped to another project is not rendered', () => {
    useButtonStore.setState({
      groups: [
        makeGroup({ id: 'g1', label: 'Foreign', scope: { type: 'projects', projectIds: ['p2'] } }),
      ],
    })
    const { container } = render(<CustomButtonBar placement="session-toolbar" />)
    expect(container).toBeEmptyDOMElement()
  })
})

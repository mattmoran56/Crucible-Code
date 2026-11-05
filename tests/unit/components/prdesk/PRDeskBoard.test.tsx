import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PRDeskBoard, groupByProject, placePRs, type PRDeskBoardProps } from '../../../../src/renderer/components/prdesk/PRDeskBoard'
import { mockDeskPRs, mockDeskProjects, mockDeskTickets } from '../../../../mock/mockData'

const setup = (over: Partial<PRDeskBoardProps> = {}) => {
  const props: PRDeskBoardProps = {
    prs: mockDeskPRs,
    tickets: mockDeskTickets,
    projects: mockDeskProjects,
    parked: [],
    me: 'alice',
    view: 'expanded',
    scope: 'all',
    activePRNumber: null,
    onOpen: vi.fn(),
    onOpenExternal: vi.fn(),
    onTogglePark: vi.fn(),
    ...over,
  }
  render(<PRDeskBoard {...props} />)
  return props
}

const column = (name: string) => screen.getByRole('region', { name })

describe('placePRs', () => {
  it('sorts the sample PRs into every stage', () => {
    const placed = placePRs(mockDeskPRs, { tickets: mockDeskTickets, parked: [], me: 'alice', scope: 'all' })
    const nums = (k: keyof typeof placed) => placed[k].map((p) => p.pr.number).sort()
    expect(nums('draft')).toEqual([40, 44])
    expect(nums('ready')).toEqual([38, 45, 47])
    expect(nums('assigned')).toEqual([39])
    expect(nums('parked')).toEqual([33, 35])
    expect(nums('pending')).toEqual([36, 42])
  })

  it('keeps only PRs that involve me in Mine', () => {
    const placed = placePRs(mockDeskPRs, { tickets: {}, parked: [], me: 'alice', scope: 'mine' })
    const all = Object.values(placed).flat().map((p) => p.pr.number).sort()
    expect(all).toEqual([38, 42, 44, 45])
  })
})

describe('groupByProject', () => {
  it('makes a row per project, oldest first, with No project last', () => {
    const placed = placePRs(mockDeskPRs, { tickets: mockDeskTickets, parked: [], me: 'alice', scope: 'all' })
    const rows = groupByProject(placed, mockDeskProjects)
    expect(rows.map((r) => r.project?.title ?? null)).toEqual(['Review workflow', 'Terminal polish', 'Insights & usage', null])
    expect(rows[0].stages.draft.map((p) => p.pr.number)).toEqual([44])
    expect(rows[3].stages.parked.map((p) => p.pr.number)).toEqual([35])
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(mockDeskPRs.length)
  })

  it('puts a ticket whose project did not load under No project', () => {
    const placed = placePRs(mockDeskPRs, { tickets: mockDeskTickets, parked: [], me: 'alice', scope: 'all' })
    const rows = groupByProject(placed, {})
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBeNull()
  })
})

describe('PRDeskBoard', () => {
  it('compact: renders the five stage columns', () => {
    setup({ view: 'compact' })
    for (const name of ['Draft', 'Pending', 'Ready for me', 'Assigned', 'Parked']) {
      expect(column(name)).toBeInTheDocument()
    }
    expect(within(column('Ready for me')).getByTestId('pr-desk-card-47')).toBeInTheDocument()
  })

  it('expanded: a row per Notion project, each split into stages', () => {
    setup()
    for (const name of ['Review workflow', 'Terminal polish', 'Insights & usage', 'No project']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    const parked = screen.getByRole('group', { name: 'Insights & usage: Parked' })
    expect(within(parked).getByText('Ticket status “Deprioritised”')).toBeInTheDocument()
    const noProject = screen.getByRole('group', { name: 'No project: Parked' })
    expect(within(noProject).getByText('Label “on-hold”')).toBeInTheDocument()
  })

  it('expanded: the project name links out to Notion', async () => {
    const props = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Open Terminal polish in Notion' }))
    expect(props.onOpenExternal).toHaveBeenCalledWith(Object.values(mockDeskProjects)[1].url)
  })

  it('opens the PR when a card is clicked', async () => {
    const props = setup()
    await userEvent.click(screen.getByText('Show the usage meter in the status bar'))
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ number: 47 }))
  })

  it('opens Notion and GitHub externally without opening the PR', async () => {
    const props = setup()
    const card = screen.getByTestId('pr-desk-card-47')
    await userEvent.click(within(card).getByRole('button', { name: /Notion/ }))
    expect(props.onOpenExternal).toHaveBeenCalledWith(mockDeskTickets[Object.keys(mockDeskTickets)[2]].url)
    await userEvent.click(within(card).getByRole('button', { name: /GitHub/ }))
    expect(props.onOpenExternal).toHaveBeenCalledWith('https://github.com/example/codecrucible/pull/47')
    expect(props.onOpen).not.toHaveBeenCalled()
  })

  it('shows the ticket id and status on expanded cards', () => {
    setup()
    const card = screen.getByTestId('pr-desk-card-47')
    expect(within(card).getByText('ENG-1215')).toBeInTheDocument()
    expect(within(card).getByText('In review')).toBeInTheDocument()
  })

  it('parks and unparks', async () => {
    const props = setup({ parked: [47] })
    const card = within(screen.getByRole('group', { name: 'Insights & usage: Parked' })).getByTestId('pr-desk-card-47')
    expect(within(card).getByText('Parked by you')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Unpark' }))
    expect(props.onTogglePark).toHaveBeenCalledWith(47)
  })

  it('compact cards show number, title and author only', () => {
    setup({ view: 'compact' })
    const card = screen.getByTestId('pr-desk-card-47')
    expect(within(card).getByText('#47')).toBeInTheDocument()
    expect(within(card).getByTitle('carol')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /GitHub/ })).toBeNull()
  })
})

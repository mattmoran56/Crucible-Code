import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPicker } from '../../../../src/renderer/components/settings/ProjectPicker'
import type { Project } from '../../../../src/shared/types'

const projects: Project[] = [
  { id: 'p1', name: 'Alpha', repoPath: '/repos/alpha' },
  { id: 'p2', name: 'Beta', repoPath: '/repos/beta' },
  { id: 'p3', name: 'Gamma', repoPath: '/repos/gamma' },
]

describe('ProjectPicker', () => {
  it('renders the Project label text', () => {
    render(<ProjectPicker projects={projects} value="p1" onChange={() => {}} />)
    expect(screen.getByText('Project')).toBeInTheDocument()
  })

  it('renders a combobox with one option per project', () => {
    render(<ProjectPicker projects={projects} value="p1" onChange={() => {}} />)
    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('option values are project ids and labels are project names', () => {
    render(<ProjectPicker projects={projects} value="p1" onChange={() => {}} />)
    const option = screen.getByRole('option', { name: 'Beta' }) as HTMLOptionElement
    expect(option.value).toBe('p2')
  })

  it('reflects the value prop as the selected option', () => {
    render(<ProjectPicker projects={projects} value="p2" onChange={() => {}} />)
    expect(screen.getByRole('combobox')).toHaveValue('p2')
    expect((screen.getByRole('option', { name: 'Beta' }) as HTMLOptionElement).selected).toBe(true)
  })

  it('calls onChange with the chosen project id', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ProjectPicker projects={projects} value="p1" onChange={onChange} />)
    await user.selectOptions(screen.getByRole('combobox'), 'p3')
    expect(onChange).toHaveBeenCalledWith('p3')
  })

  it('can select by visible option label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ProjectPicker projects={projects} value="p1" onChange={onChange} />)
    await user.selectOptions(screen.getByRole('combobox'), screen.getByRole('option', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('p3')
  })

  it('omits the default option unless includeDefault is set', () => {
    render(<ProjectPicker projects={projects} value="p1" onChange={() => {}} />)
    expect(screen.queryByRole('option', { name: 'Default (all projects)' })).not.toBeInTheDocument()
  })

  it('prepends a __default__ option when includeDefault is true', () => {
    render(<ProjectPicker projects={projects} value="__default__" onChange={() => {}} includeDefault />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(4)
    expect((options[0] as HTMLOptionElement).value).toBe('__default__')
    expect(options[0]).toHaveTextContent('Default (all projects)')
  })

  it('uses the custom defaultLabel for the default option', () => {
    render(
      <ProjectPicker
        projects={projects}
        value="__default__"
        onChange={() => {}}
        includeDefault
        defaultLabel="Everything"
      />
    )
    expect(screen.getByRole('option', { name: 'Everything' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Default (all projects)' })).not.toBeInTheDocument()
  })

  it('selecting the default option reports __default__', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ProjectPicker projects={projects} value="p1" onChange={onChange} includeDefault />)
    await user.selectOptions(screen.getByRole('combobox'), '__default__')
    expect(onChange).toHaveBeenCalledWith('__default__')
  })

  it('renders no options for an empty project list without includeDefault', () => {
    render(<ProjectPicker projects={[]} value="" onChange={() => {}} />)
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('applies a custom className to the wrapper', () => {
    const { container } = render(
      <ProjectPicker projects={projects} value="p1" onChange={() => {}} className="my-extra" />
    )
    expect(container.querySelector('.my-extra')).not.toBeNull()
  })
})

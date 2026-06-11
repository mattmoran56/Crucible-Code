import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotesStore } from '../../../src/renderer/stores/notesStore'
import { useToastStore } from '../../../src/renderer/stores/toastStore'

const list = vi.fn()
const save = vi.fn()
const del = vi.fn()

beforeEach(() => {
  list.mockReset()
  save.mockReset()
  del.mockReset()
  ;(window as any).api = {
    notes: { list, save, delete: del },
  }
  useNotesStore.setState({ notes: [], selectedNoteId: null })
  useToastStore.setState({ toasts: [] })
})

describe('notesStore.loadNotes', () => {
  it('loads notes from the api and clears selection', async () => {
    const fixture = [{ id: 'n1', title: 'a', content: 'a', createdAt: 't', updatedAt: 't' }]
    list.mockResolvedValue(fixture)
    await useNotesStore.getState().loadNotes('p1')
    expect(list).toHaveBeenCalledWith('p1')
    expect(useNotesStore.getState().notes).toEqual(fixture)
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
  })

  it('surfaces an error toast if the api throws', async () => {
    list.mockRejectedValue(new Error('disk full'))
    await useNotesStore.getState().loadNotes('p1')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ type: 'error', message: 'disk full' })
  })
})

describe('notesStore.addNote', () => {
  it('prepends a new note, selects it, and persists', async () => {
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const { notes, selectedNoteId } = useNotesStore.getState()
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Untitled')
    expect(notes[0].content).toBe('')
    expect(selectedNoteId).toBe(notes[0].id)
    expect(save).toHaveBeenCalledWith('p1', notes)
  })
})

describe('notesStore.updateNote', () => {
  it('updates content and derives the title from the first line', async () => {
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const id = useNotesStore.getState().notes[0].id
    await useNotesStore.getState().updateNote('p1', id, 'New title line\nbody continues')
    const note = useNotesStore.getState().notes[0]
    expect(note.title).toBe('New title line')
    expect(note.content).toBe('New title line\nbody continues')
  })

  it('falls back to "Untitled" for blank content', async () => {
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const id = useNotesStore.getState().notes[0].id
    await useNotesStore.getState().updateNote('p1', id, '')
    expect(useNotesStore.getState().notes[0].title).toBe('Untitled')
  })

  it('truncates long titles to 60 chars', async () => {
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const id = useNotesStore.getState().notes[0].id
    const huge = 'x'.repeat(120)
    await useNotesStore.getState().updateNote('p1', id, huge)
    expect(useNotesStore.getState().notes[0].title).toHaveLength(60)
  })
})

describe('notesStore.deleteNote', () => {
  it('removes the note, clears selection if it was selected, and calls api.delete', async () => {
    save.mockResolvedValue(undefined)
    del.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const id = useNotesStore.getState().notes[0].id
    await useNotesStore.getState().deleteNote('p1', id)
    expect(useNotesStore.getState().notes).toHaveLength(0)
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
    expect(del).toHaveBeenCalledWith('p1', id)
  })

  it('keeps selection when deleting a different note', async () => {
    save.mockResolvedValue(undefined)
    del.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    await useNotesStore.getState().addNote('p1')
    const [first, second] = useNotesStore.getState().notes
    useNotesStore.getState().selectNote(first.id)
    await useNotesStore.getState().deleteNote('p1', second.id)
    expect(useNotesStore.getState().selectedNoteId).toBe(first.id)
  })
})

const seedNote = (id: string, content = `content ${id}`) => ({
  id,
  title: `title ${id}`,
  content,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('notesStore optimistic updates on persistence failure', () => {
  it('addNote keeps the new note locally and toasts when save fails', async () => {
    save.mockRejectedValue(new Error('readonly'))
    await useNotesStore.getState().addNote('p1')
    expect(useNotesStore.getState().notes).toHaveLength(1)
    expect(useNotesStore.getState().selectedNoteId).toBe(useNotesStore.getState().notes[0].id)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'readonly' })
  })

  it('updateNote keeps the local edit and toasts when save fails', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    save.mockRejectedValue(new Error('disk gone'))
    await useNotesStore.getState().updateNote('p1', 'n1', 'edited text')
    expect(useNotesStore.getState().notes[0].content).toBe('edited text')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'disk gone' })
  })

  it('deleteNote keeps the removal and toasts when the api delete fails', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    del.mockRejectedValue(new Error('locked'))
    await useNotesStore.getState().deleteNote('p1', 'n1')
    expect(useNotesStore.getState().notes).toEqual([])
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'locked' })
  })

  it('loadNotes stringifies non-Error rejections in the toast', async () => {
    list.mockRejectedValue('EACCES')
    await useNotesStore.getState().loadNotes('p1')
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: 'error', message: 'EACCES' })
  })
})

describe('notesStore.updateNote details', () => {
  it('ignores unknown ids but still persists the unchanged list', async () => {
    const existing = seedNote('n1')
    useNotesStore.setState({ notes: [existing] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().updateNote('p1', 'missing', 'whatever')
    expect(useNotesStore.getState().notes).toEqual([existing])
    expect(save).toHaveBeenCalledWith('p1', [existing])
  })

  it('derives Untitled when the first line is blank but a body follows', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().updateNote('p1', 'n1', '\nsecond line has text')
    expect(useNotesStore.getState().notes[0].title).toBe('Untitled')
  })

  it('trims surrounding whitespace when deriving the title', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().updateNote('p1', 'n1', '   Hello World   \nbody')
    expect(useNotesStore.getState().notes[0].title).toBe('Hello World')
  })

  it('bumps updatedAt but preserves id and createdAt', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().updateNote('p1', 'n1', 'fresh')
    const note = useNotesStore.getState().notes[0]
    expect(note.id).toBe('n1')
    expect(note.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(note.updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  it('leaves sibling notes untouched', async () => {
    const other = seedNote('n2')
    useNotesStore.setState({ notes: [seedNote('n1'), other] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().updateNote('p1', 'n1', 'changed')
    expect(useNotesStore.getState().notes[1]).toEqual(other)
  })
})

describe('notesStore selection and ordering', () => {
  it('addNote prepends ahead of existing notes', async () => {
    useNotesStore.setState({ notes: [seedNote('older')] })
    save.mockResolvedValue(undefined)
    await useNotesStore.getState().addNote('p1')
    const notes = useNotesStore.getState().notes
    expect(notes).toHaveLength(2)
    expect(notes[1].id).toBe('older')
    expect(notes[0].title).toBe('Untitled')
  })

  it('selectNote sets and clears the selection without touching notes', () => {
    useNotesStore.setState({ notes: [seedNote('n1')] })
    useNotesStore.getState().selectNote('n1')
    expect(useNotesStore.getState().selectedNoteId).toBe('n1')
    useNotesStore.getState().selectNote(null)
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
    expect(useNotesStore.getState().notes).toHaveLength(1)
  })

  it('loadNotes clears a previously selected note id', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')], selectedNoteId: 'n1' })
    list.mockResolvedValue([seedNote('n2')])
    await useNotesStore.getState().loadNotes('p1')
    expect(useNotesStore.getState().selectedNoteId).toBeNull()
    expect(useNotesStore.getState().notes[0].id).toBe('n2')
  })

  it('deleteNote with an unknown id leaves notes intact but still calls the api', async () => {
    useNotesStore.setState({ notes: [seedNote('n1')], selectedNoteId: 'n1' })
    del.mockResolvedValue(undefined)
    await useNotesStore.getState().deleteNote('p1', 'ghost')
    expect(useNotesStore.getState().notes).toHaveLength(1)
    expect(useNotesStore.getState().selectedNoteId).toBe('n1')
    expect(del).toHaveBeenCalledWith('p1', 'ghost')
  })
})

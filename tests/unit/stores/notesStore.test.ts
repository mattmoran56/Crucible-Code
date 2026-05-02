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

import { create } from 'zustand'
import type { Note } from '../../shared/types'
import { useToastStore } from './toastStore'

interface NotesState {
  notes: Note[]
  selectedNoteId: string | null
  loadNotes: (projectId: string) => Promise<void>
  addNote: (projectId: string) => Promise<void>
  updateNote: (projectId: string, id: string, content: string) => Promise<void>
  deleteNote: (projectId: string, id: string) => Promise<void>
  selectNote: (id: string | null) => void
}

function titleFromContent(content: string): string {
  const firstLine = content.split('\n')[0].trim()
  return firstLine.slice(0, 60) || 'Untitled'
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  selectedNoteId: null,

  loadNotes: async (projectId) => {
    try {
      const notes = await window.api.notes.list(projectId)
      set({ notes, selectedNoteId: null })
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  addNote: async (projectId) => {
    const now = new Date().toISOString()
    const note: Note = {
      id: crypto.randomUUID(),
      title: 'Untitled',
      content: '',
      createdAt: now,
      updatedAt: now,
    }
    const notes = [note, ...get().notes]
    set({ notes, selectedNoteId: note.id })
    try {
      await window.api.notes.save(projectId, notes)
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  updateNote: async (projectId, id, content) => {
    const now = new Date().toISOString()
    const notes = get().notes.map((n) =>
      n.id === id
        ? { ...n, content, title: titleFromContent(content), updatedAt: now }
        : n
    )
    set({ notes })
    try {
      await window.api.notes.save(projectId, notes)
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  deleteNote: async (projectId, id) => {
    const notes = get().notes.filter((n) => n.id !== id)
    const selectedNoteId = get().selectedNoteId === id ? null : get().selectedNoteId
    set({ notes, selectedNoteId })
    try {
      await window.api.notes.delete(projectId, id)
    } catch (err) {
      useToastStore.getState().addToast('error', err instanceof Error ? err.message : String(err))
    }
  },

  selectNote: (id) => set({ selectedNoteId: id }),
}))

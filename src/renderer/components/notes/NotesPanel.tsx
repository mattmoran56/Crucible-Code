import React, { useEffect, useRef, useState } from 'react'
import { useNotesStore } from '../../stores/notesStore'
import { useProjectStore } from '../../stores/projectStore'
import { IconButton, ListBox, ListItem } from '../ui'

export function NotesPanel() {
  const { activeProjectId } = useProjectStore()
  const { notes, selectedNoteId, loadNotes, addNote, updateNote, deleteNote, selectNote } =
    useNotesStore()

  const [localContent, setLocalContent] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Keep a ref to latest content so cleanup effect can flush without stale closure
  const localContentRef = useRef(localContent)

  useEffect(() => {
    localContentRef.current = localContent
  }, [localContent])

  useEffect(() => {
    if (activeProjectId) {
      loadNotes(activeProjectId)
    } else {
      useNotesStore.setState({ notes: [], selectedNoteId: null })
    }
  }, [activeProjectId])

  const selectedNote = notes.find((n) => n.id === selectedNoteId) ?? null

  // Sync local content when switching notes
  useEffect(() => {
    setLocalContent(selectedNote?.content ?? '')
  }, [selectedNoteId])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        if (activeProjectId && selectedNoteId) {
          updateNote(activeProjectId, selectedNoteId, localContentRef.current)
        }
      }
    }
  }, [activeProjectId, selectedNoteId])

  const handleContentChange = (value: string) => {
    setLocalContent(value)
    if (!activeProjectId || !selectedNoteId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      updateNote(activeProjectId, selectedNoteId, value)
    }, 500)
  }

  if (!activeProjectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-text-muted text-xs text-center">Select a project to see notes</p>
      </div>
    )
  }

  // Detail view
  if (selectedNote) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div
          className="flex items-center gap-2 border-b border-border flex-shrink-0"
          style={{ padding: '6px 8px' }}
        >
          <IconButton label="Back to notes" onClick={() => selectNote(null)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </IconButton>
          <span className="text-xs text-text-muted truncate flex-1">{selectedNote.title}</span>
        </div>
        <textarea
          className="w-full flex-1 resize-none bg-transparent text-text text-sm outline-none font-mono"
          style={{ padding: '10px 12px' }}
          value={localContent}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="Start writing..."
          autoFocus
        />
      </div>
    )
  }

  // List view
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center justify-between border-b border-border flex-shrink-0"
        style={{ padding: '6px 8px 6px 12px' }}
      >
        <span className="text-xs text-text-muted">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</span>
        <IconButton label="New note" onClick={() => addNote(activeProjectId)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </IconButton>
      </div>

      {notes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-text-muted text-xs text-center">No notes yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ListBox label="Notes" onSelect={(i) => selectNote(notes[i].id)}>
            {notes.map((note) => (
              <ListItem
                key={note.id}
                onClick={() => selectNote(note.id)}
                style={{ padding: '7px 8px 7px 12px' }}
                className="flex items-center gap-2 group"
              >
                <span className="flex-1 text-sm text-text truncate min-w-0">{note.title}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                  <IconButton
                    label="Edit note"
                    onClick={(e) => {
                      e.stopPropagation()
                      selectNote(note.id)
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </IconButton>
                  <IconButton
                    label="Delete note"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteNote(activeProjectId, note.id)
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
                    </svg>
                  </IconButton>
                </div>
              </ListItem>
            ))}
          </ListBox>
        </div>
      )}
    </div>
  )
}

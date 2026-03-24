import { ipcMain } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { Note } from '../../shared/types'

const store = new Store<{ notes: Record<string, Note[]> }>({
  name: 'notes',
  defaults: { notes: {} },
})

export function registerNotesHandlers() {
  ipcMain.handle(IPC.NOTES_LIST, async (_e, projectId: string): Promise<Note[]> => {
    return store.get('notes', {})[projectId] ?? []
  })

  ipcMain.handle(IPC.NOTES_SAVE, async (_e, projectId: string, notes: Note[]): Promise<void> => {
    const all = store.get('notes', {})
    all[projectId] = notes
    store.set('notes', all)
  })

  ipcMain.handle(IPC.NOTES_DELETE, async (_e, projectId: string, noteId: string): Promise<void> => {
    const all = store.get('notes', {})
    all[projectId] = (all[projectId] ?? []).filter((n) => n.id !== noteId)
    store.set('notes', all)
  })
}

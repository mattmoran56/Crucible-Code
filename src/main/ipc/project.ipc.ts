import { ipcMain, dialog, BrowserWindow } from 'electron'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { Project, Session } from '../../shared/types'

const store = new Store<{
  projects: Project[]
  sessions: Record<string, Session[]>
}>({
  defaults: {
    projects: [],
    sessions: {},
  },
})

export function registerProjectHandlers(window: BrowserWindow) {
  ipcMain.handle(IPC.PROJECT_LIST, async () => {
    return store.get('projects', [])
  })

  ipcMain.handle(IPC.PROJECT_ADD, async (_e, project: Project) => {
    const projects = store.get('projects', [])
    projects.push(project)
    store.set('projects', projects)
    return projects
  })

  ipcMain.handle(IPC.PROJECT_REMOVE, async (_e, projectId: string) => {
    const projects = store.get('projects', []).filter((p) => p.id !== projectId)
    store.set('projects', projects)
    return projects
  })

  ipcMain.handle(IPC.PROJECT_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select a Git repository folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.SESSION_LIST, async (_e, projectId: string) => {
    const sessions = store.get('sessions', {})
    return sessions[projectId] || []
  })

  ipcMain.handle(IPC.SESSION_SAVE, async (_e, projectId: string, sessionList: Session[]) => {
    const sessions = store.get('sessions', {})
    sessions[projectId] = sessionList
    store.set('sessions', sessions)
  })
}

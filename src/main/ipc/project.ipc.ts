import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import * as pty from 'node-pty'
import Store from 'electron-store'
import { IPC } from '../../shared/constants'
import type { Project, Session, ClaudeAccount } from '../../shared/types'

// Auth terminal instances (lightweight, separate from session terminals)
const authTerminals = new Map<string, pty.IPty>()

const store = new Store<{
  projects: Project[]
  sessions: Record<string, Session[]>
  accounts: ClaudeAccount[]
}>({
  defaults: {
    projects: [],
    sessions: {},
    accounts: [],
  },
})

function resolveConfigDir(configDir: string): string {
  if (configDir.startsWith('~/')) {
    return join(homedir(), configDir.slice(2))
  }
  return configDir
}

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

  ipcMain.handle(IPC.PROJECT_REORDER, async (_e, projectIds: string[]) => {
    const projects = store.get('projects', [])
    const reordered = projectIds.map((id) => projects.find((p) => p.id === id)!).filter(Boolean)
    store.set('projects', reordered)
    return reordered
  })

  ipcMain.handle(IPC.PROJECT_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select a Git repository folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.PROJECT_UPDATE, async (_e, project: Project) => {
    const projects = store.get('projects', [])
    const index = projects.findIndex((p) => p.id === project.id)
    if (index >= 0) {
      projects[index] = project
      store.set('projects', projects)
    }
    return projects
  })

  // Accounts
  ipcMain.handle(IPC.ACCOUNT_LIST, async () => {
    return store.get('accounts', [])
  })

  ipcMain.handle(IPC.ACCOUNT_SAVE, async (_e, accounts: ClaudeAccount[]) => {
    store.set('accounts', accounts)
  })

  ipcMain.handle(IPC.ACCOUNT_AUTH_STATUS, async (_e, configDir: string) => {
    try {
      const resolved = resolveConfigDir(configDir)
      const settingsPath = join(resolved, 'settings.json')
      if (!existsSync(settingsPath)) return { email: null, orgName: null }
      const raw = readFileSync(settingsPath, 'utf-8')
      const data = JSON.parse(raw)
      return {
        email: data.email ?? null,
        orgName: data.orgName ?? null,
      }
    } catch {
      return { email: null, orgName: null }
    }
  })

  // Auth terminal — spawn a pty running `claude auth login` with CLAUDE_CONFIG_DIR
  ipcMain.handle(IPC.ACCOUNT_AUTH_SPAWN, async (_e, authId: string, configDir: string) => {
    // Kill any existing auth terminal with this ID
    const existing = authTerminals.get(authId)
    if (existing) {
      existing.kill()
      authTerminals.delete(authId)
    }

    const resolved = resolveConfigDir(configDir)
    const shell = process.env.SHELL || '/bin/zsh'
    const ptyProcess = pty.spawn(shell, ['-l', '-c', 'claude auth login'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 16,
      cwd: homedir(),
      env: {
        ...process.env,
        CLAUDE_CONFIG_DIR: resolved,
      } as Record<string, string>,
    })

    authTerminals.set(authId, ptyProcess)

    ptyProcess.onData((data) => {
      window.webContents.send('account:auth-data', authId, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      authTerminals.delete(authId)
      window.webContents.send('account:auth-exit', authId, exitCode)
    })

    return authId
  })

  ipcMain.handle(IPC.ACCOUNT_AUTH_KILL, async (_e, authId: string) => {
    const p = authTerminals.get(authId)
    if (p) {
      p.kill()
      authTerminals.delete(authId)
    }
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

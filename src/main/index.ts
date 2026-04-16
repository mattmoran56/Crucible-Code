import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import fixPath from 'fix-path'
import { registerAllHandlers } from './ipc/register'
import {
  startNotificationServer,
  stopNotificationServer,
} from './services/notification-server'
import { killAllTerminals } from './services/terminal.service'
import { stopAllWatching as stopAllPermissionWatching } from './services/permission-sync.service'
import { stopAllWatching as stopAllConfigWatching } from './services/config-sync.service'

// When launched from Finder/Dock, process.env.PATH is the minimal macOS default
// and won't include Homebrew, nvm, etc. This sources the user's shell PATH so
// git, gh, and credential helpers resolve correctly.
fixPath()

let mainWindow: BrowserWindow | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#faf6f1',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow!.show())

  // Start the notification HTTP server before registering handlers
  await startNotificationServer(mainWindow)

  registerAllHandlers(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('before-quit', () => {
  killAllTerminals()
  stopAllPermissionWatching()
  stopAllConfigWatching()
  stopNotificationServer()
})

app.on('window-all-closed', () => {
  killAllTerminals()
  stopAllPermissionWatching()
  stopAllConfigWatching()
  stopNotificationServer()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerAllHandlers } from './ipc/register'
import {
  startNotificationServer,
  stopNotificationServer,
  setWindowFocused,
} from './services/notification-server'

let mainWindow: BrowserWindow | null = null

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Start the notification HTTP server before registering handlers
  await startNotificationServer(mainWindow)

  registerAllHandlers(mainWindow)

  // Track window focus for notification suppression
  mainWindow.on('focus', () => setWindowFocused(true))
  mainWindow.on('blur', () => setWindowFocused(false))

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  stopNotificationServer()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

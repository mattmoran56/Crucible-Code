import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import fixPath from 'fix-path'
import { registerAllHandlers } from './ipc/register'
import {
  startNotificationServer,
  stopNotificationServer,
} from './services/notification-server'
import { setNotificationWindow } from './services/notification.service'
import { killAllTerminals } from './services/terminal.service'
import { stopAllWatching as stopAllPermissionWatching } from './services/permission-sync.service'
import { stopScheduler } from './services/scheduler.service'
import { stopFoundryService } from './services/foundry.service'
import { stopLocalPRService } from './services/local-pr.service'
import { startKeepAwake, stopKeepAwake } from './services/keep-awake.service'
import { eventBus } from './services/event-bus'
import { startRelayIfEnabled, stopRelayServer } from '../../remote/server/relay-server'
import { unregisterCloud } from '../../remote/server/cloud-client'

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

  // Dual-emit every renderer message onto the in-process event bus so the
  // embedded relay server can fan the same events out to paired remote
  // receivers. Zero touch on existing webContents.send call sites.
  const origSend = mainWindow.webContents.send.bind(mainWindow.webContents)
  mainWindow.webContents.send = ((channel: string, ...args: unknown[]) => {
    origSend(channel, ...(args as []))
    eventBus.emit(channel, ...args)
  }) as typeof mainWindow.webContents.send

  // Start the notification HTTP server before registering handlers
  await startNotificationServer(mainWindow)
  setNotificationWindow(mainWindow)

  registerAllHandlers(mainWindow)

  // Start the embedded LAN relay if the user has previously enabled it.
  // The Remote toggle in the renderer top bar controls this flag.
  await startRelayIfEnabled()

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Keep the Mac awake for the whole lifetime of the app so terminals,
  // Claude sessions, foundry workers and the relay keep running while the
  // screen is locked. Released on quit (below).
  startKeepAwake()
  return createWindow()
})

let cloudUnregistered = false
app.on('before-quit', (event) => {
  // Best-effort POST /unregister so the relay drops our token + ticket
  // immediately rather than waiting on the 30-day idle alarm. 2s timeout
  // inside unregisterCloud keeps a hung relay from blocking quit.
  if (!cloudUnregistered) {
    event.preventDefault()
    cloudUnregistered = true
    void unregisterCloud().finally(() => app.quit())
  }
  killAllTerminals()
  stopAllPermissionWatching()
  stopNotificationServer()
  stopScheduler()
  stopFoundryService()
  stopLocalPRService()
  stopRelayServer()
  stopKeepAwake()
})

app.on('window-all-closed', () => {
  killAllTerminals()
  stopAllPermissionWatching()
  stopNotificationServer()
  stopScheduler()
  stopFoundryService()
  stopLocalPRService()
  stopRelayServer()
  stopKeepAwake()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

import { app } from 'electron'
import fixPath from 'fix-path'
import { registerAllHandlers } from './ipc/register'
import {
  findContextById,
  startNotificationServer,
  stopNotificationServer,
} from './services/notification-server'
import { setNotificationFocusResolver } from './services/notification.service'
import { killAllTerminals } from './services/terminal.service'
import { killAllVisualAgents } from './services/visual-agent/visual-agent.service'
import { stopScheduler } from './services/scheduler.service'
import { startKeepAwake, stopKeepAwake } from './services/keep-awake.service'
import {
  appWindows,
  focusWindowForProject,
  openInitialWindows,
  reopenWindows,
} from './services/window-manager.service'
import { listProjectIds } from './ipc/project.ipc'
import { startRelayIfEnabled, stopRelayServer } from '../../remote/server/relay-server'
import { unregisterCloud } from '../../remote/server/cloud-client'
import { scrubInheritedClaudeSession } from './services/claude-env'
import { reapOrphanedSessionSandboxes } from './services/sandboxer.service'
import { killAllJobs as killSandboxerJobs } from './services/sandboxer-jobs.service'

// When launched from Finder/Dock, process.env.PATH is the minimal macOS default
// and won't include Homebrew, nvm, etc. This sources the user's shell PATH so
// git, gh, and credential helpers resolve correctly.
fixPath()

// Launched from inside a Claude Code session (an agent running `npm run dev`,
// a Claude Code terminal), the app inherits its child-session markers, and
// every claude we spawn would then run with transcript saving off. See
// claude-env.ts.
scrubInheritedClaudeSession(process.env)

// The app can have several windows, each showing its own set of project tabs
// (see window-manager.service.ts). Handlers and services get `appWindows`,
// which delivers their events to every window.
async function startApp() {
  // Start the notification HTTP server before registering handlers
  await startNotificationServer(appWindows)
  // A notification click brings forward the window showing that project.
  setNotificationFocusResolver((contextId) =>
    focusWindowForProject(findContextById(contextId)?.projectId ?? projectIdFromContext(contextId))
  )

  registerAllHandlers(appWindows)

  // Start the embedded LAN relay if the user has previously enabled it.
  // The Remote toggle in the renderer top bar controls this flag.
  await startRelayIfEnabled()

  openInitialWindows(listProjectIds)
}

/** Code-editor contexts carry their project id (`code-editor:<projectId>`). */
function projectIdFromContext(contextId: string): string | undefined {
  return contextId.startsWith('code-editor:') ? contextId.slice('code-editor:'.length) : undefined
}

app.whenReady().then(() => {
  // Keep the Mac awake for the whole lifetime of the app so terminals,
  // Claude sessions and the relay keep running while the
  // screen is locked. Released on quit (below).
  startKeepAwake()
  // Destroy sandboxes whose session worktree is already gone (deleted while
  // Docker was down, or the app quit mid-delete). Off the startup path.
  setTimeout(() => void reapOrphanedSessionSandboxes(), 15_000)
  return startApp()
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
  killAllVisualAgents()
  stopNotificationServer()
  stopScheduler()
  stopRelayServer()
  stopKeepAwake()
  killSandboxerJobs()
})

app.on('window-all-closed', () => {
  killAllTerminals()
  killAllVisualAgents()
  stopNotificationServer()
  stopScheduler()
  stopRelayServer()
  stopKeepAwake()
  app.quit()
})

app.on('activate', () => {
  reopenWindows()
})

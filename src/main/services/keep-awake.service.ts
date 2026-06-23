import { powerSaveBlocker, powerMonitor } from 'electron'

// Keep the machine awake for as long as the app is running.
//
// We use `prevent-app-suspension` (not `prevent-display-sleep`): this stops the
// *system* from going to sleep — so the app and every child process it owns
// (PTY terminals, Claude sessions, foundry workers, the relay server) keep
// running — while still letting the *display* turn off when the screen locks.
// In other words: lock the screen, the Mac stays awake and our work continues.
// `prevent-display-sleep` would also force the screen to stay on, which is not
// what we want.

let blockerId: number | null = null
let resumeHandler: (() => void) | null = null

function isActive(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}

function acquire(): void {
  if (isActive()) return
  blockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log(`[keep-awake] system sleep prevented (blocker ${blockerId})`)
}

/**
 * Start preventing the system from sleeping while the app is running.
 * Safe to call multiple times; re-arms on resume in case macOS released the
 * blocker while suspended.
 */
export function startKeepAwake(): void {
  acquire()

  if (!resumeHandler) {
    // After a forced sleep / resume the blocker can be dropped by the OS.
    // Re-acquire on resume so we stay awake for the rest of the session.
    resumeHandler = () => {
      if (!isActive()) {
        console.log('[keep-awake] re-arming after resume')
        acquire()
      }
    }
    powerMonitor.on('resume', resumeHandler)
  }
}

/** Release the blocker and stop re-arming. Called on app quit. */
export function stopKeepAwake(): void {
  if (resumeHandler) {
    powerMonitor.off('resume', resumeHandler)
    resumeHandler = null
  }
  if (blockerId !== null) {
    if (powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId)
    }
    console.log(`[keep-awake] system sleep allowed again (blocker ${blockerId})`)
    blockerId = null
  }
}

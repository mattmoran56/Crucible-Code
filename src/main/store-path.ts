import { app } from 'electron'
import { join } from 'path'

/**
 * Returns the config directory for electron-store instances.
 * Dev instances use a 'dev' subdirectory to prevent cross-instance contamination.
 */
export function getStorePath(): string {
  const base = app.getPath('userData')
  return app.isPackaged ? base : join(base, 'dev')
}

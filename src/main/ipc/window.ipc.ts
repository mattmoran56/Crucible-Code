import { handle } from './handle'
import { IPC } from '../../shared/constants'
import * as windows from '../services/window-manager.service'

/**
 * Multiple app windows. Every handler acts on the window that sent the
 * request; requests from the remote relay (no sender) get null / no-op.
 */
export function registerWindowHandlers(): void {
  handle(IPC.WINDOW_GET_LAYOUT, async (e) => windows.getLayoutFor(e?.sender))

  handle(
    IPC.WINDOW_SET_LAYOUT,
    async (e, projectIds: string[], activeProjectId: string | null) =>
      windows.setLayoutFor(e?.sender, Array.isArray(projectIds) ? projectIds : [], activeProjectId ?? null)
  )

  handle(IPC.WINDOW_LIST, async (e) => windows.listWindows(e?.sender))

  handle(IPC.WINDOW_SEND_TAB, async (e, projectId: string, toWindowId: string) =>
    windows.sendTab(e?.sender, projectId, toWindowId)
  )

  handle(IPC.WINDOW_TAB_DRAG_START, async (e, projectId: string, grab?: { x: number; y: number }) =>
    windows.startTabDrag(e?.sender, projectId, grab)
  )

  handle(IPC.WINDOW_TAB_DRAG_END, async (e, opts?: { cancel?: boolean; copy?: boolean }) =>
    windows.endTabDrag(e?.sender, opts)
  )

  handle(IPC.WINDOW_TAB_STRIP, async (e, geometry: unknown) => windows.reportTabStrip(e?.sender, geometry))

  handle(IPC.WINDOW_OPEN_PROJECT, async (e, projectId: string, mode?: 'move' | 'copy') =>
    windows.openProjectInNewWindow(e?.sender, projectId, mode === 'copy' ? 'copy' : 'move')
  )
}

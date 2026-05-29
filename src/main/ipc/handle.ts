import { ipcMain, IpcMainInvokeEvent } from 'electron'

/**
 * Drop-in replacement for `ipcMain.handle` that ALSO records the handler in a
 * shared map. The embedded relay server (remote/server/bridge.ts) looks up
 * handlers here to service `req` frames from paired browser receivers via the
 * same code paths the local renderer exercises through `ipcRenderer.invoke`.
 *
 * Signature mirrors `ipcMain.handle` exactly — call sites only change name.
 */
type IpcHandler = (event: IpcMainInvokeEvent | undefined, ...args: any[]) => any

export const handlerMap = new Map<string, IpcHandler>()

export function handle(channel: string, fn: IpcHandler): void {
  handlerMap.set(channel, fn)
  ipcMain.handle(channel, fn as any)
}

/** Invoke a registered handler by name. Used by the relay bridge. */
export async function invokeHandler(channel: string, args: unknown[]): Promise<unknown> {
  const fn = handlerMap.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return await fn(undefined, ...args)
}

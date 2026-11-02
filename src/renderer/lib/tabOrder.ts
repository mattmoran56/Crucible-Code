/**
 * Move `ids[from]` so it lands before the item that was at `insertBefore`
 * (0..ids.length, where ids.length means "at the end"). Returns a new array.
 */
export function moveToInsertionPoint<T>(ids: T[], from: number, insertBefore: number): T[] {
  if (from < 0 || from >= ids.length) return [...ids]
  const target = insertBefore > from ? insertBefore - 1 : insertBefore
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(target, next.length)), 0, moved)
  return next
}

/** The tab to activate after `removedId` is closed: the one that slides into its slot, else the new last. */
export function neighbourAfterClose(ids: string[], removedId: string): string | null {
  const idx = ids.indexOf(removedId)
  const rest = ids.filter((id) => id !== removedId)
  if (rest.length === 0) return null
  return rest[Math.min(Math.max(idx, 0), rest.length - 1)]
}

/** MIME type carrying a dragged project tab between windows. */
export const PROJECT_TAB_MIME = 'application/x-crucible-project-tab'

export interface ProjectTabDragPayload {
  token: string
  projectId: string
  fromWindowId: string | null
}

export function parseTabDragPayload(raw: string): ProjectTabDragPayload | null {
  try {
    const v = JSON.parse(raw)
    if (v && typeof v.token === 'string' && typeof v.projectId === 'string') {
      return { token: v.token, projectId: v.projectId, fromWindowId: typeof v.fromWindowId === 'string' ? v.fromWindowId : null }
    }
  } catch {
    /* not ours */
  }
  return null
}

/**
 * Pure bookkeeping for which project tabs live in which app window.
 *
 * Kept free of Electron so it can be unit-tested. The window manager
 * (window-manager.service.ts) owns the BrowserWindows and calls these to work
 * out each window's tab list.
 *
 * Invariants every function here preserves (given a reconciled input):
 *   - a window never lists the same project twice;
 *   - a window's activeProjectId is one of its projectIds (or null when empty);
 *   - a project may be open in several windows (e.g. two worktrees of the same
 *     repo side by side), and every known project is open in at least one.
 */

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutEntry {
  id: string
  projectIds: string[]
  activeProjectId: string | null
  bounds?: WindowBounds
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}

/** Pick a sensible active tab after `removed` left `before` (the old tab order). */
function nextActive(before: string[], after: string[], current: string | null, removed: string): string | null {
  if (after.length === 0) return null
  if (current && current !== removed && after.includes(current)) return current
  // Chrome-style: activate the tab that slid into the removed tab's slot, or
  // the new last tab when the removed one was last.
  const idx = before.indexOf(removed)
  return after[Math.min(Math.max(idx, 0), after.length - 1)]
}

function withActive(entry: LayoutEntry): LayoutEntry {
  const active =
    entry.activeProjectId && entry.projectIds.includes(entry.activeProjectId)
      ? entry.activeProjectId
      : entry.projectIds[0] ?? null
  return { ...entry, activeProjectId: active }
}

/**
 * Bring a saved layout in line with the current project list: drop projects
 * that no longer exist, drop windows left empty, put any project no window
 * shows into the first window, and always return at least one window.
 */
export function reconcileLayouts(
  saved: LayoutEntry[],
  projectIds: string[],
  newId: () => string
): LayoutEntry[] {
  const known = new Set(projectIds)
  let layouts = saved
    .map((w) => withActive({ ...w, projectIds: dedupe(w.projectIds.filter((id) => known.has(id))) }))
    .filter((w) => w.projectIds.length > 0)

  // Windows with duplicate ids (hand-edited store, old bug) keep the first.
  const seen = new Set<string>()
  layouts = layouts.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)))

  if (layouts.length === 0) {
    const first = saved[0]
    return [withActive({ id: first?.id ?? newId(), projectIds: [...projectIds], activeProjectId: null, bounds: first?.bounds })]
  }

  const shown = new Set(layouts.flatMap((w) => w.projectIds))
  const missing = projectIds.filter((id) => !shown.has(id))
  if (missing.length > 0) {
    layouts[0] = withActive({ ...layouts[0], projectIds: [...layouts[0].projectIds, ...missing] })
  }
  return layouts
}

/** Replace one window's tabs/active project (e.g. after a reorder or tab click). */
export function setWindowTabs(
  layouts: LayoutEntry[],
  windowId: string,
  projectIds: string[],
  activeProjectId: string | null
): LayoutEntry[] {
  return layouts.map((w) =>
    w.id === windowId ? withActive({ ...w, projectIds: dedupe(projectIds), activeProjectId }) : w
  )
}

/** Add a project tab to a window (and focus it). No-op if it is already there, besides focusing. */
export function addProjectToWindow(
  layouts: LayoutEntry[],
  windowId: string,
  projectId: string,
  index?: number
): LayoutEntry[] {
  return layouts.map((w) => {
    if (w.id !== windowId) return w
    const without = w.projectIds.filter((id) => id !== projectId)
    const at = index === undefined ? without.length : Math.max(0, Math.min(index, without.length))
    const projectIds = [...without.slice(0, at), projectId, ...without.slice(at)]
    return { ...w, projectIds, activeProjectId: projectId }
  })
}

/** Remove a project tab from one window. Leaves the window in place even if it becomes empty. */
export function removeProjectFromWindow(
  layouts: LayoutEntry[],
  windowId: string,
  projectId: string
): LayoutEntry[] {
  return layouts.map((w) => {
    if (w.id !== windowId || !w.projectIds.includes(projectId)) return w
    const projectIds = w.projectIds.filter((id) => id !== projectId)
    return { ...w, projectIds, activeProjectId: nextActive(w.projectIds, projectIds, w.activeProjectId, projectId) }
  })
}

/** Remove a deleted project from every window. */
export function removeProjectEverywhere(layouts: LayoutEntry[], projectId: string): LayoutEntry[] {
  return layouts.reduce((acc, w) => removeProjectFromWindow(acc, w.id, projectId), layouts)
}

/**
 * Move a project tab from one window to another, inserting it at `index` in
 * the target (end when omitted) and focusing it there. Moving within the same
 * window is a reorder.
 */
export function moveProject(
  layouts: LayoutEntry[],
  projectId: string,
  fromWindowId: string,
  toWindowId: string,
  index?: number
): LayoutEntry[] {
  const removed = fromWindowId === toWindowId ? layouts : removeProjectFromWindow(layouts, fromWindowId, projectId)
  return addProjectToWindow(removed, toWindowId, projectId, index)
}

/** Projects that would no longer be open anywhere if `windowId` closed. */
export function projectsOnlyIn(layouts: LayoutEntry[], windowId: string): string[] {
  const target = layouts.find((w) => w.id === windowId)
  if (!target) return []
  const elsewhere = new Set(layouts.filter((w) => w.id !== windowId).flatMap((w) => w.projectIds))
  return target.projectIds.filter((id) => !elsewhere.has(id))
}

/**
 * Close a window without losing projects: any project only it showed is
 * appended (unfocused) to `intoWindowId`. Returns the layouts without the
 * closed window.
 */
export function closeWindow(layouts: LayoutEntry[], windowId: string, intoWindowId: string | null): LayoutEntry[] {
  const orphans = projectsOnlyIn(layouts, windowId)
  const rest = layouts.filter((w) => w.id !== windowId)
  if (!intoWindowId || orphans.length === 0) return rest
  return rest.map((w) =>
    w.id === intoWindowId ? withActive({ ...w, projectIds: dedupe([...w.projectIds, ...orphans]) }) : w
  )
}

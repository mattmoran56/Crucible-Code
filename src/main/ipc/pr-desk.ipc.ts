import { shell } from 'electron'
import Store from 'electron-store'
import { handle } from './handle'
import { IPC } from '../../shared/constants'
import type { DeskTicketRef } from '../../shared/prDesk'
import { getDeskTickets, listDeskPRs } from '../services/pr-desk.service'
import { getStorePath } from '../store-path'

// PRs the user parked by hand on the desk, per project.
const store = new Store<{ parked: Record<string, number[]> }>({
  name: 'pr-desk',
  cwd: getStorePath(),
  defaults: { parked: {} },
})

/** Only GitHub and Notion links leave the app from the desk. */
export function isDeskExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return (
      u.hostname === 'github.com' ||
      u.hostname === 'notion.so' ||
      u.hostname.endsWith('.notion.so') ||
      u.hostname.endsWith('.notion.site') ||
      u.hostname === 'app.notion.com'
    )
  } catch {
    return false
  }
}

export function registerPRDeskHandlers(): void {
  handle(IPC.PR_DESK_LIST, async (_e, repoPath: string) => listDeskPRs(repoPath))

  handle(IPC.PR_DESK_TICKETS, async (_e, projectId: string, refs: DeskTicketRef[]) =>
    getDeskTickets(projectId, refs)
  )

  handle(IPC.PR_DESK_PARKED_GET, async (_e, projectId: string): Promise<number[]> => {
    return store.get('parked', {})[projectId] ?? []
  })

  handle(IPC.PR_DESK_PARKED_SET, async (_e, projectId: string, numbers: number[]): Promise<void> => {
    const all = store.get('parked', {})
    all[projectId] = [...new Set(numbers.filter((n) => Number.isInteger(n)))]
    store.set('parked', all)
  })

  handle(IPC.PR_DESK_OPEN_EXTERNAL, async (_e, url: string): Promise<void> => {
    if (!isDeskExternalUrl(url)) throw new Error('Refusing to open a non-GitHub/Notion URL')
    await shell.openExternal(url)
  })
}

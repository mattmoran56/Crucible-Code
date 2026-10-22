import type { SandboxTeardownReport } from '../../shared/types'
import { useProjectStore } from '../stores/projectStore'
import { useToastStore } from '../stores/toastStore'

/**
 * Tell the user when removing a worktree left a Sandboxer sandbox behind. A
 * skipped teardown (CLI missing, Docker down) only matters for projects that
 * use Sandboxer — everyone else would see it on every delete.
 */
export function warnAboutSandboxTeardown(
  report: SandboxTeardownReport | void | undefined,
  repoPath: string
): void {
  if (!report) return
  const addToast = useToastStore.getState().addToast
  if (report.failed.length > 0) {
    addToast(
      'error',
      `Sandbox not destroyed — ${report.failed.join('; ')}. Run \`sandboxer gc\` to reap it.`
    )
    return
  }
  const enabled = useProjectStore
    .getState()
    .projects.some((p) => p.repoPath === repoPath && p.sandboxer?.enabled)
  if (report.skipped && enabled) {
    addToast(
      'error',
      `Couldn't check for this session's sandbox (${report.skipped}). It will be reaped on the next launch once Docker is running.`
    )
  }
}

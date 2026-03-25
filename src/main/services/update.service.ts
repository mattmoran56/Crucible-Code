import { app } from 'electron'
import { join } from 'path'
import { cpSync } from 'fs'
import { spawn } from 'child_process'
import simpleGit from 'simple-git'
import type { UpdateStatus } from '../../shared/types'

declare const __REPO_PATH__: string
declare const __BUILT_COMMIT__: string

let pollInterval: NodeJS.Timeout | null = null

export async function startUpdatePoller(
  onStatus: (status: UpdateStatus) => void
): Promise<void> {
  if (!app.isPackaged) return

  const check = async () => {
    try {
      const g = simpleGit(__REPO_PATH__).env('GIT_TERMINAL_PROMPT', '0')
      await g.fetch(['origin', '--quiet'])
      const result = await g.raw(['rev-list', '--count', `${__BUILT_COMMIT__}..origin/main`])
      const count = parseInt(result.trim(), 10)
      if (count > 0) {
        onStatus({ state: 'available', commitCount: count })
      } else {
        onStatus({ state: 'idle' })
      }
    } catch {
      // Network failure — skip this poll cycle silently
    }
  }

  await check()
  pollInterval = setInterval(check, 60 * 1000)
}

export function stopUpdatePoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

export async function applyUpdate(
  onLog: (line: string) => void,
  onStatus: (status: UpdateStatus) => void
): Promise<void> {
  try {
    onStatus({ state: 'updating' })
    onLog('Pulling latest commits...')

    const g = simpleGit(__REPO_PATH__).env('GIT_TERMINAL_PROMPT', '0')
    await g.pull('origin', 'main')
    onLog('git pull done')

    onLog('Building...')
    await runBuild(onLog)
    onLog('Build done, installing...')

    const repoOut = join(__REPO_PATH__, 'out')
    const bundleOut = join(app.getAppPath(), 'out')
    cpSync(repoOut, bundleOut, { recursive: true, force: true } as any)

    app.relaunch()
    app.quit()
  } catch (err) {
    onStatus({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}

function runBuild(onLog: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const shell = process.env.SHELL || '/bin/zsh'
    const child = spawn(shell, ['-l', '-c', 'npm run build'], {
      cwd: __REPO_PATH__,
    })

    child.stdout.on('data', (d: Buffer) => onLog(d.toString().trimEnd()))
    child.stderr.on('data', (d: Buffer) => onLog(d.toString().trimEnd()))

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Build exited with code ${code}`))
    })

    child.on('error', reject)
  })
}

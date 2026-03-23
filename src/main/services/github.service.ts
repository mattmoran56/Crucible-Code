import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PullRequest } from '../../shared/types'

const execFileAsync = promisify(execFile)

export async function listOpenPRs(repoPath: string): Promise<PullRequest[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--state',
        'open',
        '--json',
        'number,title,headRefName,author,updatedAt',
        '--limit',
        '50',
      ],
      { cwd: repoPath }
    )

    const raw = JSON.parse(stdout) as Array<{
      number: number
      title: string
      headRefName: string
      author: { login: string }
      updatedAt: string
    }>

    return raw.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      author: pr.author.login,
      updatedAt: pr.updatedAt,
    }))
  } catch {
    return []
  }
}

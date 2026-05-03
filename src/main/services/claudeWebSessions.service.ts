import simpleGit, { SimpleGit } from 'simple-git'
import type { ClaudeWebSession } from '../../shared/types'

const DEFAULT_PREFIX = 'claude/'

function git(repoPath: string): SimpleGit {
  return simpleGit(repoPath)
}

export function normalizePrefix(prefix: string | undefined): string {
  let p = (prefix ?? '').trim()
  if (!p) return DEFAULT_PREFIX
  p = p.replace(/^refs\/heads\//, '')
  if (!p.endsWith('/')) p = `${p}/`
  return p
}

interface AuthorInfo {
  email: string
  name: string
}

const NOREPLY_RE = /^\d+\+([^@]+)@users\.noreply\.github\.com$/i

export function isAuthorMine(
  authorEmail: string,
  myGitEmail: string | null,
  myGithubLogin: string | null
): boolean {
  if (!authorEmail) return false
  const lower = authorEmail.toLowerCase()
  if (myGitEmail && lower === myGitEmail.toLowerCase()) return true
  if (myGithubLogin) {
    const m = lower.match(NOREPLY_RE)
    if (m && m[1].toLowerCase() === myGithubLogin.toLowerCase()) return true
  }
  return false
}

const authorCache = new Map<string, AuthorInfo>()

async function getAuthorForSha(g: SimpleGit, sha: string): Promise<AuthorInfo | null> {
  const cached = authorCache.get(sha)
  if (cached) return cached
  try {
    const raw = await g.raw(['log', '-1', '--format=%ae|%an', sha])
    const line = raw.trim()
    const sep = line.indexOf('|')
    if (sep < 0) return null
    const info: AuthorInfo = {
      email: line.slice(0, sep),
      name: line.slice(sep + 1),
    }
    authorCache.set(sha, info)
    return info
  } catch {
    return null
  }
}

async function getMyGitEmail(g: SimpleGit): Promise<string | null> {
  try {
    const raw = await g.raw(['config', 'user.email'])
    const email = raw.trim()
    return email || null
  } catch {
    return null
  }
}

export async function listClaudeWebSessions(
  repoPath: string,
  prefix: string | undefined,
  githubLogin: string | null
): Promise<ClaudeWebSession[]> {
  const g = git(repoPath)
  const normalized = normalizePrefix(prefix)
  const refspec = `+refs/heads/${normalized}*:refs/remotes/origin/${normalized}*`

  try {
    await g.raw(['fetch', '--prune', 'origin', refspec])
  } catch {
    // No remote, no matching refs, or transient network — fall through and
    // surface whatever we already have locally.
  }

  let raw: string
  try {
    raw = await g.raw([
      'for-each-ref',
      '--format=%(refname:short)|%(objectname)|%(committerdate:iso8601)',
      `refs/remotes/origin/${normalized}`,
    ])
  } catch {
    return []
  }

  const myGitEmail = await getMyGitEmail(g)
  if (!myGitEmail && !githubLogin) return []

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  const out: ClaudeWebSession[] = []

  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 3) continue
    const refShort = parts[0]
    const sha = parts[1]
    const date = parts.slice(2).join('|')
    const branchName = refShort.replace(/^origin\//, '')
    if (branchName === 'HEAD' || branchName.endsWith('/HEAD')) continue

    const author = await getAuthorForSha(g, sha)
    if (!author) continue
    if (!isAuthorMine(author.email, myGitEmail, githubLogin)) continue

    out.push({
      branchName,
      headSha: sha,
      lastCommitDate: date,
      authorName: author.name,
    })
  }

  out.sort((a, b) => b.lastCommitDate.localeCompare(a.lastCommitDate))
  return out
}

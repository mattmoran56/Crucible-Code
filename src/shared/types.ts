export interface Project {
  id: string
  name: string
  repoPath: string
}

export interface Session {
  id: string
  name: string
  branchName: string
  worktreePath: string
  projectId: string
  createdAt: string
  prNumber?: number
  baseBranch?: string
}

export interface Commit {
  hash: string
  message: string
  author: string
  date: string
}

export interface FileDiff {
  filePath: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  insertions: number
  deletions: number
}

export interface WorktreeInfo {
  path: string
  branch: string
}

export interface PullRequest {
  number: number
  title: string
  headRefName: string
  author: string
  updatedAt: string
  isDraft: boolean
}

export interface PRFile {
  path: string
  additions: number
  deletions: number
  status: string
}

export interface PRComment {
  id: number
  body: string
  path: string
  line: number | null
  side: 'LEFT' | 'RIGHT'
  author: string
  createdAt: string
}

export type PRReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export type PRMergeMethod = 'merge' | 'squash' | 'rebase'

export interface UpdateStatus {
  state: 'idle' | 'available' | 'updating' | 'error'
  commitCount?: number
  error?: string
}

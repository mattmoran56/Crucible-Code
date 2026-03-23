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
}

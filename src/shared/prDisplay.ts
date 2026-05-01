export type PRListField =
  | 'state'
  | 'ci'
  | 'unseen'
  | 'attention'
  | 'number'
  | 'branches'
  | 'author'
  | 'labels'
  | 'requestedReviewers'
  | 'reviewerStates'
  | 'assignees'
  | 'commentsCount'
  | 'updatedAt'

export type PRLabelFilter =
  | { mode: 'all' }
  | { mode: 'only'; names: string[] }

export interface PRListDisplay {
  fields: Record<PRListField, boolean>
  labelFilter: PRLabelFilter
}

export const PR_LIST_FIELDS: Array<{ key: PRListField; label: string; description: string }> = [
  { key: 'state', label: 'State', description: 'Open / draft / merged dot' },
  { key: 'ci', label: 'CI status', description: 'Check, X or spinner icon' },
  { key: 'unseen', label: 'New badge', description: 'Marker for PRs you have not opened yet' },
  { key: 'attention', label: 'Attention badge', description: 'Marker when an agent is waiting' },
  { key: 'number', label: 'PR number', description: '#123 prefix on the title' },
  { key: 'branches', label: 'Branches', description: 'head → base branch row' },
  { key: 'author', label: 'Author', description: 'GitHub login of the PR author' },
  { key: 'labels', label: 'Labels', description: 'Coloured label chips' },
  { key: 'requestedReviewers', label: 'Requested reviewers', description: 'Users whose review is requested' },
  { key: 'reviewerStates', label: 'Reviewer states', description: 'Submitted reviewers tinted by approval state' },
  { key: 'assignees', label: 'Assignees', description: 'Users assigned to the PR' },
  { key: 'commentsCount', label: 'Comments count', description: 'Total review + conversation comments' },
  { key: 'updatedAt', label: 'Updated', description: 'Relative time since the PR was last updated' },
]

export const DEFAULT_PR_LIST_DISPLAY: PRListDisplay = {
  fields: {
    state: true,
    ci: true,
    unseen: true,
    attention: true,
    number: true,
    branches: true,
    author: true,
    labels: false,
    requestedReviewers: false,
    reviewerStates: false,
    assignees: false,
    commentsCount: false,
    updatedAt: false,
  },
  labelFilter: { mode: 'all' },
}

export function displaysEqual(a: PRListDisplay, b: PRListDisplay): boolean {
  for (const { key } of PR_LIST_FIELDS) {
    if (a.fields[key] !== b.fields[key]) return false
  }
  if (a.labelFilter.mode !== b.labelFilter.mode) return false
  if (a.labelFilter.mode === 'only' && b.labelFilter.mode === 'only') {
    if (a.labelFilter.names.length !== b.labelFilter.names.length) return false
    const sortedA = [...a.labelFilter.names].sort()
    const sortedB = [...b.labelFilter.names].sort()
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false
    }
  }
  return true
}

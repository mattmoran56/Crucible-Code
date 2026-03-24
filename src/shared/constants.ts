// IPC channel names — single source of truth
export const IPC = {
  // Git
  GIT_STATUS: 'git:status',
  GIT_LOG: 'git:log',
  GIT_DIFF: 'git:diff',
  GIT_FILE_DIFF: 'git:file-diff',
  GIT_CHECKOUT: 'git:checkout',
  GIT_RESTORE_WORKTREE: 'git:restore-worktree',
  GIT_WORKING_FILES: 'git:working-files',
  GIT_WORKING_FILE_DIFF: 'git:working-file-diff',
  GIT_COMMIT_STATUSES: 'git:commit-statuses',
  GIT_PUSH: 'git:push',
  GIT_OPEN_PR: 'git:open-pr',
  GIT_LIST_BRANCHES: 'git:list-branches',
  GIT_MERGE_CHECK: 'git:merge-check',
  GIT_MERGE: 'git:merge',
  GIT_IS_MERGED: 'git:is-merged',

  // Worktree
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_REMOVE: 'worktree:remove',

  // Terminal
  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_HOOK_EVENT: 'notification:hook-event',
  NOTIFICATION_CLEAR: 'notification:clear',
  NOTIFICATION_GET_PORT: 'notification:get-port',

  // Focus tracking
  FOCUS_SET_ACTIVE_CONTEXT: 'focus:set-active-context',

  // Projects (persisted via electron-store)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_REORDER: 'project:reorder',
  PROJECT_SELECT_FOLDER: 'project:select-folder',

  // Sessions
  SESSION_LIST: 'session:list',
  SESSION_SAVE: 'session:save',

  // Pull Requests
  PR_LIST: 'pr:list',
  PR_SEEN_GET: 'pr:seen:get',
  PR_SEEN_SET: 'pr:seen:set',
  PR_DIFF: 'pr:diff',
  PR_FILES: 'pr:files',
  PR_COMMENTS: 'pr:comments',
  PR_COMMENT_CREATE: 'pr:comment:create',
  PR_REVIEW: 'pr:review',
  PR_MERGE: 'pr:merge',
  PR_MERGEABILITY: 'pr:mergeability',
  PR_DETAIL: 'pr:detail',
  PR_CONVERSATION: 'pr:conversation',
  PR_CHECKS: 'pr:checks',

  // Worktree (remote branch)
  WORKTREE_CREATE_FROM_BRANCH: 'worktree:create-from-branch',

  // Self-update
  UPDATE_STATUS: 'update:status',
  UPDATE_APPLY: 'update:apply',
  UPDATE_LOG: 'update:log',

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_SAVE: 'notes:save',
  NOTES_DELETE: 'notes:delete',
} as const

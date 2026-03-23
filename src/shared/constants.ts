// IPC channel names — single source of truth
export const IPC = {
  // Git
  GIT_STATUS: 'git:status',
  GIT_LOG: 'git:log',
  GIT_DIFF: 'git:diff',
  GIT_FILE_DIFF: 'git:file-diff',

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

  // Projects (persisted via electron-store)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_SELECT_FOLDER: 'project:select-folder',

  // Sessions
  SESSION_LIST: 'session:list',
  SESSION_SAVE: 'session:save',

  // Pull Requests
  PR_LIST: 'pr:list',
  PR_SEEN_GET: 'pr:seen:get',
  PR_SEEN_SET: 'pr:seen:set',

  // Worktree (remote branch)
  WORKTREE_CREATE_FROM_BRANCH: 'worktree:create-from-branch',
} as const

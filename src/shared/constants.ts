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
  NOTIFICATION_HOOK_EVENT: 'notification:hook-event',
  NOTIFICATION_CLEAR: 'notification:clear',
  NOTIFICATION_GET_PORT: 'notification:get-port',

  // Focus tracking
  FOCUS_SET_ACTIVE_CONTEXT: 'focus:set-active-context',

  // Projects (persisted via electron-store)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_SELECT_FOLDER: 'project:select-folder',

  // Sessions
  SESSION_LIST: 'session:list',
  SESSION_SAVE: 'session:save',
} as const

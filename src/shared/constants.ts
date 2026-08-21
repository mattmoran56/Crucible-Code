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
  GIT_DEFAULT_BRANCH: 'git:default-branch',
  GIT_COMPARE_COMMITS: 'git:compare-commits',
  GIT_COMPARE_FILES: 'git:compare-files',
  GIT_COMPARE_DIFF: 'git:compare-diff',
  GIT_COMPARE_FILE_DIFF: 'git:compare-file-diff',
  GIT_COMMIT_FULL_DIFF: 'git:commit-full-diff',
  GIT_WORKING_FILES_PR: 'git:working-files-pr',
  GIT_WORKING_DIFF: 'git:working-diff',
  GIT_SHOW_FILE_BASE64: 'git:show-file-base64',
  GIT_SHOW_FILE: 'git:show-file',
  GIT_FETCH_AND_PULL: 'git:fetch-and-pull',

  // Worktree
  WORKTREE_CREATE: 'worktree:create',
  WORKTREE_LIST: 'worktree:list',
  WORKTREE_REMOVE: 'worktree:remove',
  WORKTREE_RENAME_BRANCH: 'worktree:rename-branch',
  WORKTREE_CREATE_FOR_PR: 'worktree:create-for-pr',
  WORKTREE_LIST_PR: 'worktree:list-pr',
  WORKTREE_REMOVE_PR: 'worktree:remove-pr',

  // Terminal
  TERMINAL_SPAWN: 'terminal:spawn',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_KILL_SESSION: 'terminal:kill-session',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_RECOVERY_LIST: 'terminal:recovery-list',
  TERMINAL_LIST_FOR_SESSION: 'terminal:list-for-session',
  TERMINAL_GET_BUFFER: 'terminal:get-buffer',

  // Notifications
  NOTIFICATION_SHOW: 'notification:show',
  NOTIFICATION_HOOK_EVENT: 'notification:hook-event',
  NOTIFICATION_SESSION_STATUS: 'notification:session-status',
  NOTIFICATION_CLEAR: 'notification:clear',
  NOTIFICATION_GET_PORT: 'notification:get-port',
  NOTIFICATION_SET_BADGE: 'notification:set-badge',
  NOTIFICATION_FOCUS_REQUEST: 'notification:focus-request',

  // Projects (persisted via electron-store)
  PROJECT_LIST: 'project:list',
  PROJECT_ADD: 'project:add',
  PROJECT_REMOVE: 'project:remove',
  PROJECT_REORDER: 'project:reorder',
  PROJECT_SELECT_FOLDER: 'project:select-folder',

  // Sessions
  SESSION_LIST: 'session:list',
  SESSION_SAVE: 'session:save',
  SESSION_CONTEXT_SAVE: 'session:context:save',
  SESSION_CONTEXT_GET: 'session:context:get',

  // Pull Requests
  PR_LIST: 'pr:list',
  PR_CURRENT_USER: 'pr:current-user',
  PR_SEEN_GET: 'pr:seen:get',
  PR_SEEN_SET: 'pr:seen:set',
  PR_DIFF: 'pr:diff',
  PR_FILE_PATCH: 'pr:file-patch',
  PR_FILES: 'pr:files',
  PR_COMMENTS: 'pr:comments',
  PR_COMMENT_CREATE: 'pr:comment:create',
  PR_REVIEW: 'pr:review',
  PR_MERGE: 'pr:merge',
  PR_MERGEABILITY: 'pr:mergeability',
  PR_DETAIL: 'pr:detail',
  PR_CONVERSATION: 'pr:conversation',
  PR_CHECKS: 'pr:checks',
  PR_VIEWED_GET: 'pr:viewed:get',
  PR_VIEWED_SET: 'pr:viewed:set',
  PR_COMMITS: 'pr:commits',
  PR_COMMIT_DIFF: 'pr:commit:diff',
  PR_REVIEW_THREADS: 'pr:review:threads',
  PR_REVIEWER_ADD: 'pr:reviewer:add',
  PR_REVIEWER_REMOVE: 'pr:reviewer:remove',
  PR_COLLABORATORS: 'pr:collaborators',
  PR_FILE_BLOB: 'pr:file-blob',
  PR_THREAD_REPLY: 'pr:thread:reply',
  PR_THREAD_RESOLVE: 'pr:thread:resolve',
  PR_THREAD_UNRESOLVE: 'pr:thread:unresolve',
  PR_APPLY_SUGGESTION: 'pr:apply-suggestion',
  PR_REPO_LABELS: 'pr:repo-labels',

  // Git mutations
  GIT_DISCARD_FILE: 'git:discard-file',
  GIT_STAGE_FILE: 'git:stage-file',
  GIT_UNSTAGE_FILE: 'git:unstage-file',
  GIT_STASH_FILE: 'git:stash-file',
  GIT_REVEAL_FILE: 'git:reveal-file',

  // Worktree (remote branch)
  WORKTREE_CREATE_FROM_BRANCH: 'worktree:create-from-branch',

  // Accounts
  ACCOUNT_LIST: 'account:list',
  ACCOUNT_SAVE: 'account:save',
  ACCOUNT_AUTH_STATUS: 'account:auth-status',
  ACCOUNT_AUTH_SPAWN: 'account:auth-spawn',
  ACCOUNT_AUTH_KILL: 'account:auth-kill',

  // Projects (mutation)
  PROJECT_UPDATE: 'project:update',

  // Self-update
  UPDATE_STATUS: 'update:status',
  UPDATE_APPLY: 'update:apply',
  UPDATE_LOG: 'update:log',
  UPDATE_BUILT_COMMIT: 'update:builtCommit',

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_SAVE: 'notes:save',
  NOTES_DELETE: 'notes:delete',

  // Usage
  USAGE_GET_SESSION: 'usage:get-session',
  USAGE_GET_STATS: 'usage:get-stats',
  USAGE_GET_SUBSCRIPTION: 'usage:get-subscription',
  USAGE_SESSION_UPDATE: 'usage:session-update',

  // Permissions
  PERMISSIONS_GET: 'permissions:get',
  PERMISSIONS_UPDATE: 'permissions:update',
  PERMISSIONS_CHANGED: 'permissions:changed',

  // File I/O
  FILE_LIST_DIR: 'file:list-dir',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_CREATE: 'file:create',
  FILE_STAT: 'file:stat',
  FILE_MOVE: 'file:move',
  FILE_READ_BASE64: 'file:read-base64',
  FILE_WATCH: 'file:watch',
  FILE_UNWATCH: 'file:unwatch',
  FILE_CHANGED: 'file:changed',

  // Custom Buttons
  BUTTON_LIST: 'button:list',
  BUTTON_SAVE: 'button:save',
  BUTTON_GROUP_LIST: 'button-group:list',
  BUTTON_GROUP_SAVE: 'button-group:save',
  BUTTON_EXECUTE: 'button:execute',

  // Session Startup Prompts (per-project)
  STARTUP_PROMPT_LIST: 'startup-prompt:list',
  STARTUP_PROMPT_SAVE: 'startup-prompt:save',

  // Review Loop
  REVIEW_LOOP_SETTINGS_GET: 'review-loop:settings:get',
  REVIEW_LOOP_SETTINGS_SET: 'review-loop:settings:set',
  REVIEW_LOOP_START: 'review-loop:start',
  REVIEW_LOOP_CANCEL: 'review-loop:cancel',
  REVIEW_LOOP_STATE_GET: 'review-loop:state:get',
  REVIEW_LOOP_STATE_UPDATE: 'review-loop:state:update',

  // Claude Web Sessions
  CLAUDE_WEB_LIST_SESSIONS: 'claude-web:list-sessions',

  // Scheduler — queued sessions and queued messages
  SCHEDULER_LIST_QUEUED_SESSIONS: 'scheduler:list-queued-sessions',
  SCHEDULER_ADD_QUEUED_SESSION: 'scheduler:add-queued-session',
  SCHEDULER_CANCEL_QUEUED_SESSION: 'scheduler:cancel-queued-session',
  SCHEDULER_RESCHEDULE_QUEUED_SESSION: 'scheduler:reschedule-queued-session',
  SCHEDULER_FIRE_QUEUED_SESSION_NOW: 'scheduler:fire-queued-session-now',
  SCHEDULER_QUEUED_SESSIONS_UPDATE: 'scheduler:queued-sessions-update',
  SCHEDULER_FIRE_QUEUED_SESSION: 'scheduler:fire-queued-session',

  SCHEDULER_LIST_QUEUED_MESSAGES: 'scheduler:list-queued-messages',
  SCHEDULER_ADD_QUEUED_MESSAGE: 'scheduler:add-queued-message',
  SCHEDULER_CANCEL_QUEUED_MESSAGE: 'scheduler:cancel-queued-message',
  SCHEDULER_QUEUED_MESSAGES_UPDATE: 'scheduler:queued-messages-update',
  SCHEDULER_FIRE_QUEUED_MESSAGE: 'scheduler:fire-queued-message',

  // Usage limit detection (rising-edge of fiveHour usedPercentage)
  USAGE_LIMIT_REACHED: 'usage:limit-reached',

  // Spawn a claude agent terminal with a heredoc-piped initial prompt — used
  // by the queued-session fire path so the prompt lands as claude's stdin
  // rather than relying on `>`-detection-then-write (which is racy in the
  // queued-fire context). Auto-restart kicks in after claude consumes the
  // heredoc and exits, putting the user back into `claude --resume`.
  SCHEDULER_SPAWN_AGENT_WITH_PROMPT: 'scheduler:spawn-agent-with-prompt',

  // Notion task integration (per-project)
  NOTION_CONFIG_LOAD: 'notion:config:load',
  NOTION_CONFIG_SAVE: 'notion:config:save',
  NOTION_TEST_CONNECTION: 'notion:test-connection',
  NOTION_GET_DATABASE_SCHEMA: 'notion:get-database-schema',
  NOTION_LIST_RELATION_OPTIONS: 'notion:list-relation-options',
  NOTION_LIST_USERS: 'notion:list-users',
  NOTION_APPLY_WRITE_BACK: 'notion:apply-write-back',
  NOTION_CLEAR_PICKED_UP: 'notion:clear-picked-up',
  NOTION_GET_CONFIG_PATH: 'notion:get-config-path',
  NOTION_FIRE_TASK: 'notion:fire-task',
  NOTION_OPEN_TICKET: 'notion:open-ticket',

  // Remote connection (embedded relay)
  REMOTE_GET_STATUS: 'remote:get-status',
  REMOTE_SET_ENABLED: 'remote:set-enabled',
  REMOTE_REGENERATE_CODE: 'remote:regenerate-code',
  REMOTE_REVOKE_ALL: 'remote:revoke-all',
  REMOTE_STATUS_CHANGED: 'remote:status-changed',
  REMOTE_SET_CLOUD_ENABLED: 'remote:set-cloud-enabled',
  REMOTE_REGENERATE_HANDLE: 'remote:regenerate-handle',
  REMOTE_SET_REQUIRE_APPROVAL: 'remote:set-require-approval',
  REMOTE_APPROVE_PAIRING: 'remote:approve-pairing',
  REMOTE_DENY_PAIRING: 'remote:deny-pairing',
  REMOTE_PAIRING_REQUESTED: 'remote:pairing-requested',
  REMOTE_SET_PAIRING_MODE: 'remote:set-pairing-mode',

  // Foundry — autopilot orchestrator over a Notion task set
  FOUNDRY_LIST: 'foundry:list',
  FOUNDRY_SAVE: 'foundry:save',
  FOUNDRY_DELETE: 'foundry:delete',
  FOUNDRY_SET_PAUSED: 'foundry:set-paused',
  FOUNDRY_RUN_NOW: 'foundry:run-now',
  FOUNDRY_STATE_GET: 'foundry:state:get',
  FOUNDRY_STATE_UPDATE: 'foundry:state:update',
  FOUNDRY_FIRE_TASK: 'foundry:fire-task',
  FOUNDRY_TASK_STARTED: 'foundry:task-started',
  FOUNDRY_SPAWN_WORKER: 'foundry:spawn-worker',
  FOUNDRY_PIPELINE_ACTION: 'foundry:pipeline-action',
  FOUNDRY_OPEN_FOREMAN: 'foundry:open-foreman',
  FOUNDRY_REQUEST_PASS: 'foundry:request-pass',
  FOUNDRY_RESET_STATE: 'foundry:reset-state',
  FOUNDRY_PUBLISH_PRS: 'foundry:publish-prs',

  // Local PRs — a session-level stage between a draft branch and an open PR
  LOCAL_PR_LIST: 'local-pr:list',
  LOCAL_PR_CREATE: 'local-pr:create',
  LOCAL_PR_UPDATE: 'local-pr:update',
  LOCAL_PR_DISCARD: 'local-pr:discard',
  LOCAL_PR_PROMOTE: 'local-pr:promote',
  LOCAL_PR_SET_CAPTURE: 'local-pr:set-capture',
  LOCAL_PR_STATE_UPDATE: 'local-pr:state:update',
  // Overseer — a master agent over every session in every project
  OVERSEER_STATE_GET: 'overseer:state:get',
  OVERSEER_STATE_UPDATE: 'overseer:state:update',
  OVERSEER_SEND: 'overseer:send',
  OVERSEER_CANCEL: 'overseer:cancel',
  OVERSEER_CLEAR: 'overseer:clear',
  OVERSEER_SETTINGS_GET: 'overseer:settings:get',
  OVERSEER_SETTINGS_SET: 'overseer:settings:set',
  OVERSEER_HEARTBEAT_NOW: 'overseer:heartbeat-now',
  OVERSEER_MARK_READ: 'overseer:mark-read',
  /** Main → renderer: the Overseer created/changed sessions; reload the list. */
  OVERSEER_SESSIONS_CHANGED: 'overseer:sessions-changed',
} as const

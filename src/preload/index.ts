import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { Project, Session, Commit, FileDiff, PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod, UpdateStatus, Note, PRDetail, PRConversationComment, PRCheck, PRReviewThread, SessionUsage, UsageStats, SubscriptionInfo, FileEntry, FileStat, ClaudeAccount, CustomButton, CustomButtonGroup, ButtonActionType, ButtonExecutionMode, ContextKind, GitHubCollaborator, PRLabel, StartupPrompt, ReviewLoopConfig, ReviewLoopSettings, ReviewLoopState, ClaudeWebSession, QueuedSession, QueuedMessage, UsageLimitEvent, NotionDatabaseSchema, NotionFireTaskPayload, NotionIntegrationConfig, NotionTaskPayload, NotionTestConnectionResult } from '../shared/types'

// Multiplex many subscribers through a single ipcRenderer listener per channel.
// Without this, each useTerminal/onData/onExit caller adds its own listener and
// trips Node's MaxListenersExceededWarning once enough sessions are open.
function makeMultiplex<Args extends unknown[]>(channel: string) {
  const listeners = new Set<(...args: Args) => void>()
  let installed = false
  return (cb: (...args: Args) => void) => {
    if (!installed) {
      installed = true
      ipcRenderer.on(channel, (_e, ...args) => {
        for (const l of listeners) l(...(args as Args))
      })
    }
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }
}

const onTerminalData = makeMultiplex<[string, string]>(IPC.TERMINAL_DATA)
const onTerminalExit = makeMultiplex<[string, number]>(IPC.TERMINAL_EXIT)

const api = {
  git: {
    status: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_STATUS, repoPath),
    log: (repoPath: string, maxCount?: number): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC.GIT_LOG, repoPath, maxCount),
    diff: (repoPath: string, commitHash: string): Promise<FileDiff[]> =>
      ipcRenderer.invoke(IPC.GIT_DIFF, repoPath, commitHash),
    fileDiff: (repoPath: string, commitHash: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_FILE_DIFF, repoPath, commitHash, filePath),
    checkout: (repoPath: string, branch: string, mode?: 'stash' | 'carry'): Promise<{ stashed: boolean; detachedWorktree?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GIT_CHECKOUT, repoPath, branch, mode),
    restoreWorktree: (worktreePath: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_RESTORE_WORKTREE, worktreePath, branch),
    workingFiles: (repoPath: string): Promise<FileDiff[]> =>
      ipcRenderer.invoke(IPC.GIT_WORKING_FILES, repoPath),
    workingFileDiff: (repoPath: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_WORKING_FILE_DIFF, repoPath, filePath),
    commitStatuses: (repoPath: string): Promise<{ unpushedHashes: string[]; newBranchHashes: string[] }> =>
      ipcRenderer.invoke(IPC.GIT_COMMIT_STATUSES, repoPath),
    push: (repoPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_PUSH, repoPath),
    openPR: (repoPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_OPEN_PR, repoPath),
    listBranches: (repoPath: string): Promise<string[]> =>
      ipcRenderer.invoke(IPC.GIT_LIST_BRANCHES, repoPath),
    defaultBranch: (repoPath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_DEFAULT_BRANCH, repoPath),
    mergeCheck: (repoPath: string, branch: string): Promise<{ hasConflicts: boolean }> =>
      ipcRenderer.invoke(IPC.GIT_MERGE_CHECK, repoPath, branch),
    merge: (repoPath: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_MERGE, repoPath, branch),
    compareCommits: (repoPath: string, baseBranch: string): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC.GIT_COMPARE_COMMITS, repoPath, baseBranch),
    compareFiles: (repoPath: string, baseBranch: string): Promise<PRFile[]> =>
      ipcRenderer.invoke(IPC.GIT_COMPARE_FILES, repoPath, baseBranch),
    compareDiff: (repoPath: string, baseBranch: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_COMPARE_DIFF, repoPath, baseBranch),
    compareFileDiff: (repoPath: string, baseBranch: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_COMPARE_FILE_DIFF, repoPath, baseBranch, filePath),
    commitFullDiff: (repoPath: string, commitHash: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_COMMIT_FULL_DIFF, repoPath, commitHash),
    workingFilesPR: (repoPath: string): Promise<PRFile[]> =>
      ipcRenderer.invoke(IPC.GIT_WORKING_FILES_PR, repoPath),
    workingDiff: (repoPath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_WORKING_DIFF, repoPath),
    showFileBase64: (repoPath: string, ref: string, filePath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.GIT_SHOW_FILE_BASE64, repoPath, ref, filePath),
    fetchAndPull: (repoPath: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_FETCH_AND_PULL, repoPath, branch),
    discardFile: (repoPath: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_DISCARD_FILE, repoPath, filePath),
    stageFile: (repoPath: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_STAGE_FILE, repoPath, filePath),
    unstageFile: (repoPath: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_UNSTAGE_FILE, repoPath, filePath),
    stashFile: (repoPath: string, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_STASH_FILE, repoPath, filePath),
    revealFile: (absolutePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_REVEAL_FILE, absolutePath),
  },

  worktree: {
    create: (repoPath: string, sessionName: string, baseBranch?: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_CREATE, repoPath, sessionName, baseBranch),
    list: (repoPath: string) => ipcRenderer.invoke(IPC.WORKTREE_LIST, repoPath),
    remove: (repoPath: string, worktreePath: string) =>
      ipcRenderer.invoke(IPC.WORKTREE_REMOVE, repoPath, worktreePath),
    createFromBranch: (
      repoPath: string,
      sessionName: string,
      remoteBranch: string
    ): Promise<{ path: string; branch: string }> =>
      ipcRenderer.invoke(IPC.WORKTREE_CREATE_FROM_BRANCH, repoPath, sessionName, remoteBranch),
  },

  terminal: {
    spawn: (
      sessionId: string,
      cwd: string,
      mode?: 'shell' | 'claude' | 'review',
      claudeTheme?: string,
      claudeConfigDir?: string,
      repoPath?: string,
      resume?: boolean,
      contextId?: string,
      tabId?: string
    ): Promise<string> =>
      ipcRenderer.invoke(
        IPC.TERMINAL_SPAWN,
        sessionId,
        cwd,
        mode,
        claudeTheme,
        claudeConfigDir,
        repoPath,
        resume,
        contextId,
        tabId
      ),
    write: (terminalId: string, data: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_WRITE, terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, terminalId, cols, rows),
    kill: (terminalId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, terminalId),
    killSession: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL_SESSION, sessionId),
    getRecoveryList: (): Promise<Array<{ terminalId: string; sessionId: string; mode: 'shell' | 'claude' | 'review'; cwd: string; claudeTheme: string; claudeConfigDir?: string; repoPath?: string; contextId?: string; tabId?: string }>> =>
      ipcRenderer.invoke(IPC.TERMINAL_RECOVERY_LIST),
    onData: (callback: (terminalId: string, data: string) => void) =>
      onTerminalData(callback),
    onExit: (callback: (terminalId: string, exitCode: number) => void) =>
      onTerminalExit(callback),
  },

  notification: {
    show: (title: string, body: string) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_SHOW, title, body),
    getPort: (): Promise<number | null> => ipcRenderer.invoke(IPC.NOTIFICATION_GET_PORT),
    triggerForSession: (contextId: string, tabId: string, hookType?: string) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_HOOK_EVENT, contextId, tabId, hookType),
    onSessionStatus: (
      callback: (contextId: string, tabId: string, hookType: string) => void
    ) => {
      const listener = (_e: any, contextId: string, tabId: string, hookType: string) =>
        callback(contextId, tabId, hookType)
      ipcRenderer.on(IPC.NOTIFICATION_SESSION_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC.NOTIFICATION_SESSION_STATUS, listener)
    },
    onFocusRequest: (callback: (contextId: string, tabId: string) => void) => {
      const listener = (_e: any, contextId: string, tabId: string) =>
        callback(contextId, tabId)
      ipcRenderer.on(IPC.NOTIFICATION_FOCUS_REQUEST, listener)
      return () => ipcRenderer.removeListener(IPC.NOTIFICATION_FOCUS_REQUEST, listener)
    },
    registerSession: (
      contextId: string,
      name: string,
      projectId: string,
      worktreePath: string,
      kind: ContextKind = 'session'
    ) =>
      ipcRenderer.invoke(
        'notification:register-session',
        contextId,
        name,
        projectId,
        worktreePath,
        kind
      ),
    unregisterSession: (contextId: string) =>
      ipcRenderer.invoke('notification:unregister-session', contextId),
    setBadge: (count: number) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_SET_BADGE, count),
  },

  project: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.PROJECT_LIST),
    add: (project: Project): Promise<Project[]> => ipcRenderer.invoke(IPC.PROJECT_ADD, project),
    remove: (projectId: string): Promise<Project[]> =>
      ipcRenderer.invoke(IPC.PROJECT_REMOVE, projectId),
    reorder: (projectIds: string[]): Promise<Project[]> =>
      ipcRenderer.invoke(IPC.PROJECT_REORDER, projectIds),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PROJECT_SELECT_FOLDER),
    update: (project: Project): Promise<Project[]> =>
      ipcRenderer.invoke(IPC.PROJECT_UPDATE, project),
  },

  account: {
    list: (): Promise<ClaudeAccount[]> => ipcRenderer.invoke(IPC.ACCOUNT_LIST),
    save: (accounts: ClaudeAccount[]): Promise<void> =>
      ipcRenderer.invoke(IPC.ACCOUNT_SAVE, accounts),
    authStatus: (configDir: string): Promise<{ email: string | null; orgName: string | null }> =>
      ipcRenderer.invoke(IPC.ACCOUNT_AUTH_STATUS, configDir),
    authSpawn: (authId: string, configDir: string): Promise<string> =>
      ipcRenderer.invoke(IPC.ACCOUNT_AUTH_SPAWN, authId, configDir),
    authKill: (authId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.ACCOUNT_AUTH_KILL, authId),
    onAuthData: (callback: (authId: string, data: string) => void) => {
      const listener = (_e: any, authId: string, data: string) => callback(authId, data)
      ipcRenderer.on('account:auth-data', listener)
      return () => ipcRenderer.removeListener('account:auth-data', listener)
    },
    onAuthExit: (callback: (authId: string, exitCode: number) => void) => {
      const listener = (_e: any, authId: string, exitCode: number) => callback(authId, exitCode)
      ipcRenderer.on('account:auth-exit', listener)
      return () => ipcRenderer.removeListener('account:auth-exit', listener)
    },
  },

  github: {
    listPRs: (repoPath: string): Promise<PullRequest[]> =>
      ipcRenderer.invoke(IPC.PR_LIST, repoPath),
    getCurrentUser: (repoPath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.PR_CURRENT_USER, repoPath),
    getSeenPRs: (projectId: string): Promise<number[]> =>
      ipcRenderer.invoke(IPC.PR_SEEN_GET, projectId),
    markPRSeen: (projectId: string, prNumber: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_SEEN_SET, projectId, prNumber),
    getDiff: (repoPath: string, prNumber: number): Promise<string | null> =>
      ipcRenderer.invoke(IPC.PR_DIFF, repoPath, prNumber),
    getFilePatch: (repoPath: string, prNumber: number, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.PR_FILE_PATCH, repoPath, prNumber, filePath),
    getFiles: (repoPath: string, prNumber: number): Promise<PRFile[]> =>
      ipcRenderer.invoke(IPC.PR_FILES, repoPath, prNumber),
    getComments: (repoPath: string, prNumber: number): Promise<PRComment[]> =>
      ipcRenderer.invoke(IPC.PR_COMMENTS, repoPath, prNumber),
    createComment: (
      repoPath: string,
      prNumber: number,
      body: string,
      path: string,
      line: number,
      startLine?: number,
      side?: 'LEFT' | 'RIGHT'
    ): Promise<PRComment> =>
      ipcRenderer.invoke(IPC.PR_COMMENT_CREATE, repoPath, prNumber, body, path, line, startLine, side),
    submitReview: (
      repoPath: string,
      prNumber: number,
      event: PRReviewEvent,
      body?: string
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_REVIEW, repoPath, prNumber, event, body),
    getMergeability: (repoPath: string, prNumber: number): Promise<{ mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' }> =>
      ipcRenderer.invoke(IPC.PR_MERGEABILITY, repoPath, prNumber),
    merge: (repoPath: string, prNumber: number, method: PRMergeMethod): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_MERGE, repoPath, prNumber, method),
    getDetail: (repoPath: string, prNumber: number): Promise<PRDetail> =>
      ipcRenderer.invoke(IPC.PR_DETAIL, repoPath, prNumber),
    getConversationComments: (repoPath: string, prNumber: number): Promise<PRConversationComment[]> =>
      ipcRenderer.invoke(IPC.PR_CONVERSATION, repoPath, prNumber),
    getChecks: (repoPath: string, prNumber: number): Promise<PRCheck[]> =>
      ipcRenderer.invoke(IPC.PR_CHECKS, repoPath, prNumber),
    getViewedFiles: (projectId: string, prNumber: number): Promise<string[]> =>
      ipcRenderer.invoke(IPC.PR_VIEWED_GET, projectId, prNumber),
    setViewedFiles: (projectId: string, prNumber: number, files: string[]): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_VIEWED_SET, projectId, prNumber, files),
    getCommits: (repoPath: string, prNumber: number): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC.PR_COMMITS, repoPath, prNumber),
    getCommitDiff: (repoPath: string, commitHash: string): Promise<string> =>
      ipcRenderer.invoke(IPC.PR_COMMIT_DIFF, repoPath, commitHash),
    getReviewThreads: (repoPath: string, prNumber: number): Promise<PRReviewThread[]> =>
      ipcRenderer.invoke(IPC.PR_REVIEW_THREADS, repoPath, prNumber),
    addReviewer: (repoPath: string, prNumber: number, login: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_REVIEWER_ADD, repoPath, prNumber, login),
    removeReviewer: (repoPath: string, prNumber: number, login: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_REVIEWER_REMOVE, repoPath, prNumber, login),
    listCollaborators: (repoPath: string): Promise<GitHubCollaborator[]> =>
      ipcRenderer.invoke(IPC.PR_COLLABORATORS, repoPath),
    getFileBlob: (repoPath: string, ref: string, filePath: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.PR_FILE_BLOB, repoPath, ref, filePath),
    replyThread: (repoPath: string, prNumber: number, rootCommentId: number, body: string): Promise<PRComment> =>
      ipcRenderer.invoke(IPC.PR_THREAD_REPLY, repoPath, prNumber, rootCommentId, body),
    resolveThread: (repoPath: string, threadId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_THREAD_RESOLVE, repoPath, threadId),
    unresolveThread: (repoPath: string, threadId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_THREAD_UNRESOLVE, repoPath, threadId),
    applySuggestion: (
      repoPath: string,
      filePath: string,
      startLine: number,
      endLine: number,
      newText: string,
      author: string
    ): Promise<{ applied: boolean; reason?: string }> =>
      ipcRenderer.invoke(IPC.PR_APPLY_SUGGESTION, repoPath, filePath, startLine, endLine, newText, author),
    listRepoLabels: (repoPath: string): Promise<PRLabel[]> =>
      ipcRenderer.invoke(IPC.PR_REPO_LABELS, repoPath),
  },

  session: {
    list: (projectId: string): Promise<Session[]> =>
      ipcRenderer.invoke(IPC.SESSION_LIST, projectId),
    save: (projectId: string, sessions: Session[]) =>
      ipcRenderer.invoke(IPC.SESSION_SAVE, projectId, sessions),
    saveContext: (projectId: string, context: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC.SESSION_CONTEXT_SAVE, projectId, context),
    getContext: (projectId: string): Promise<Record<string, unknown> | null> =>
      ipcRenderer.invoke(IPC.SESSION_CONTEXT_GET, projectId),
  },

  notes: {
    list: (projectId: string): Promise<Note[]> =>
      ipcRenderer.invoke(IPC.NOTES_LIST, projectId),
    save: (projectId: string, notes: Note[]): Promise<void> =>
      ipcRenderer.invoke(IPC.NOTES_SAVE, projectId, notes),
    delete: (projectId: string, noteId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.NOTES_DELETE, projectId, noteId),
  },

  usage: {
    getSession: (sessionId: string): Promise<SessionUsage | null> =>
      ipcRenderer.invoke(IPC.USAGE_GET_SESSION, sessionId),
    getStats: (configDir?: string): Promise<UsageStats | null> =>
      ipcRenderer.invoke(IPC.USAGE_GET_STATS, configDir),
    getSubscription: (configDir?: string): Promise<SubscriptionInfo> =>
      ipcRenderer.invoke(IPC.USAGE_GET_SUBSCRIPTION, configDir),
    onSessionUpdate: (callback: (usage: SessionUsage) => void) => {
      const listener = (_e: unknown, usage: SessionUsage) => callback(usage)
      ipcRenderer.on(IPC.USAGE_SESSION_UPDATE, listener)
      return () => ipcRenderer.removeListener(IPC.USAGE_SESSION_UPDATE, listener)
    },
    onLimitReached: (callback: (event: UsageLimitEvent) => void) => {
      const listener = (_e: unknown, event: UsageLimitEvent) => callback(event)
      ipcRenderer.on(IPC.USAGE_LIMIT_REACHED, listener)
      return () => ipcRenderer.removeListener(IPC.USAGE_LIMIT_REACHED, listener)
    },
  },

  scheduler: {
    listQueuedSessions: (): Promise<QueuedSession[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_LIST_QUEUED_SESSIONS),
    addQueuedSession: (item: QueuedSession): Promise<QueuedSession[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_ADD_QUEUED_SESSION, item),
    cancelQueuedSession: (id: string): Promise<QueuedSession[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_CANCEL_QUEUED_SESSION, id),
    rescheduleQueuedSession: (id: string, scheduledFor: number): Promise<QueuedSession[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_RESCHEDULE_QUEUED_SESSION, id, scheduledFor),
    fireQueuedSessionNow: (id: string): Promise<void> =>
      ipcRenderer.invoke(IPC.SCHEDULER_FIRE_QUEUED_SESSION_NOW, id),
    spawnAgentWithPrompt: (
      sessionId: string,
      cwd: string,
      prompt: string,
      claudeTheme: string,
      claudeConfigDir: string | undefined,
      repoPath: string | undefined,
      contextId: string,
      tabId: string
    ): Promise<string> =>
      ipcRenderer.invoke(
        IPC.SCHEDULER_SPAWN_AGENT_WITH_PROMPT,
        sessionId,
        cwd,
        prompt,
        claudeTheme,
        claudeConfigDir,
        repoPath,
        contextId,
        tabId
      ),
    onQueuedSessionsUpdate: (callback: (list: QueuedSession[]) => void) => {
      const listener = (_e: unknown, list: QueuedSession[]) => callback(list)
      ipcRenderer.on(IPC.SCHEDULER_QUEUED_SESSIONS_UPDATE, listener)
      return () => ipcRenderer.removeListener(IPC.SCHEDULER_QUEUED_SESSIONS_UPDATE, listener)
    },
    onFireQueuedSession: (callback: (item: QueuedSession) => void) => {
      const listener = (_e: unknown, item: QueuedSession) => callback(item)
      ipcRenderer.on(IPC.SCHEDULER_FIRE_QUEUED_SESSION, listener)
      return () => ipcRenderer.removeListener(IPC.SCHEDULER_FIRE_QUEUED_SESSION, listener)
    },

    listQueuedMessages: (): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_LIST_QUEUED_MESSAGES),
    addQueuedMessage: (item: QueuedMessage): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_ADD_QUEUED_MESSAGE, item),
    cancelQueuedMessage: (id: string): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(IPC.SCHEDULER_CANCEL_QUEUED_MESSAGE, id),
    onQueuedMessagesUpdate: (callback: (list: QueuedMessage[]) => void) => {
      const listener = (_e: unknown, list: QueuedMessage[]) => callback(list)
      ipcRenderer.on(IPC.SCHEDULER_QUEUED_MESSAGES_UPDATE, listener)
      return () => ipcRenderer.removeListener(IPC.SCHEDULER_QUEUED_MESSAGES_UPDATE, listener)
    },
    onFireQueuedMessage: (callback: (item: QueuedMessage) => void) => {
      const listener = (_e: unknown, item: QueuedMessage) => callback(item)
      ipcRenderer.on(IPC.SCHEDULER_FIRE_QUEUED_MESSAGE, listener)
      return () => ipcRenderer.removeListener(IPC.SCHEDULER_FIRE_QUEUED_MESSAGE, listener)
    },
  },

  file: {
    listDir: (dirPath: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke(IPC.FILE_LIST_DIR, dirPath),
    read: (filePath: string, rootPath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.FILE_READ, filePath, rootPath),
    readBase64: (filePath: string, rootPath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.FILE_READ_BASE64, filePath, rootPath),
    write: (filePath: string, content: string, rootPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_WRITE, filePath, content, rootPath),
    create: (filePath: string, rootPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_CREATE, filePath, rootPath),
    stat: (filePath: string): Promise<FileStat> =>
      ipcRenderer.invoke(IPC.FILE_STAT, filePath),
    move: (oldPath: string, newPath: string, rootPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_MOVE, oldPath, newPath, rootPath),
    watch: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_WATCH, dirPath),
    unwatch: (dirPath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.FILE_UNWATCH, dirPath),
    onChanged: (callback: (filePath: string) => void) => {
      const listener = (_e: unknown, filePath: string) => callback(filePath)
      ipcRenderer.on(IPC.FILE_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.FILE_CHANGED, listener)
    },
  },

  permissions: {
    get: (repoPath: string): Promise<{ allow: string[]; deny: string[] }> =>
      ipcRenderer.invoke(IPC.PERMISSIONS_GET, repoPath),
    update: (repoPath: string, permissions: { allow: string[]; deny: string[] }): Promise<void> =>
      ipcRenderer.invoke(IPC.PERMISSIONS_UPDATE, repoPath, permissions),
    onChanged: (callback: (repoPath: string, permissions: { allow: string[]; deny: string[] }) => void) => {
      const listener = (_e: unknown, repoPath: string, permissions: { allow: string[]; deny: string[] }) =>
        callback(repoPath, permissions)
      ipcRenderer.on(IPC.PERMISSIONS_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.PERMISSIONS_CHANGED, listener)
    },
  },

  update: {
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_e: any, status: UpdateStatus) => callback(status)
      ipcRenderer.on(IPC.UPDATE_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC.UPDATE_STATUS, listener)
    },
    onLog: (callback: (line: string) => void) => {
      const listener = (_e: any, line: string) => callback(line)
      ipcRenderer.on(IPC.UPDATE_LOG, listener)
      return () => ipcRenderer.removeListener(IPC.UPDATE_LOG, listener)
    },
    apply: (): Promise<string> => ipcRenderer.invoke(IPC.UPDATE_APPLY),
    getBuiltCommit: (): Promise<string> => ipcRenderer.invoke(IPC.UPDATE_BUILT_COMMIT),
  },

  button: {
    list: (): Promise<CustomButton[]> =>
      ipcRenderer.invoke(IPC.BUTTON_LIST),
    save: (buttons: CustomButton[]): Promise<void> =>
      ipcRenderer.invoke(IPC.BUTTON_SAVE, buttons),
    groupList: (): Promise<CustomButtonGroup[]> =>
      ipcRenderer.invoke(IPC.BUTTON_GROUP_LIST),
    groupSave: (groups: CustomButtonGroup[]): Promise<void> =>
      ipcRenderer.invoke(IPC.BUTTON_GROUP_SAVE, groups),
    execute: (
      resolvedCommand: string,
      cwd: string,
      actionType: ButtonActionType,
      executionMode: ButtonExecutionMode,
      sessionId: string
    ): Promise<string> =>
      ipcRenderer.invoke(IPC.BUTTON_EXECUTE, resolvedCommand, cwd, actionType, executionMode, sessionId),
  },

  startupPrompt: {
    list: (projectId: string): Promise<StartupPrompt[]> =>
      ipcRenderer.invoke(IPC.STARTUP_PROMPT_LIST, projectId),
    save: (projectId: string, prompts: StartupPrompt[]): Promise<void> =>
      ipcRenderer.invoke(IPC.STARTUP_PROMPT_SAVE, projectId, prompts),
  },

  reviewLoop: {
    getSettings: (): Promise<ReviewLoopSettings> =>
      ipcRenderer.invoke(IPC.REVIEW_LOOP_SETTINGS_GET),
    setSettings: (settings: ReviewLoopSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.REVIEW_LOOP_SETTINGS_SET, settings),
    start: (opts: {
      sessionId: string
      worktreePath: string
      branch: string
      baseBranch: string
      config: ReviewLoopConfig
      prNumber?: number
    }): Promise<void> => ipcRenderer.invoke(IPC.REVIEW_LOOP_START, opts),
    cancel: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.REVIEW_LOOP_CANCEL, sessionId),
    getState: (sessionId: string): Promise<ReviewLoopState | null> =>
      ipcRenderer.invoke(IPC.REVIEW_LOOP_STATE_GET, sessionId),
    onStateUpdate: (callback: (state: ReviewLoopState) => void) => {
      const listener = (_e: unknown, state: ReviewLoopState) => callback(state)
      ipcRenderer.on(IPC.REVIEW_LOOP_STATE_UPDATE, listener)
      return () => ipcRenderer.removeListener(IPC.REVIEW_LOOP_STATE_UPDATE, listener)
    },
  },

  claudeWeb: {
    listSessions: (
      repoPath: string,
      prefix: string | undefined,
      githubLogin: string | null
    ): Promise<ClaudeWebSession[]> =>
      ipcRenderer.invoke(IPC.CLAUDE_WEB_LIST_SESSIONS, repoPath, prefix, githubLogin),
  },

  notion: {
    loadConfig: (projectId: string): Promise<NotionIntegrationConfig | null> =>
      ipcRenderer.invoke(IPC.NOTION_CONFIG_LOAD, projectId),
    saveConfig: (
      projectId: string,
      config: NotionIntegrationConfig,
      opts?: { backfill?: boolean }
    ): Promise<void> => ipcRenderer.invoke(IPC.NOTION_CONFIG_SAVE, projectId, config, opts),
    testConnection: (token: string, databaseId: string): Promise<NotionTestConnectionResult> =>
      ipcRenderer.invoke(IPC.NOTION_TEST_CONNECTION, token, databaseId),
    getDatabaseSchema: (token: string, databaseId: string): Promise<NotionDatabaseSchema> =>
      ipcRenderer.invoke(IPC.NOTION_GET_DATABASE_SCHEMA, token, databaseId),
    applyWriteBack: (
      projectId: string,
      page: NotionTaskPayload,
      branch: string,
      sessionId: string
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.NOTION_APPLY_WRITE_BACK, projectId, page, branch, sessionId),
    clearPickedUp: (projectId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.NOTION_CLEAR_PICKED_UP, projectId),
    getConfigPath: (): Promise<string> => ipcRenderer.invoke(IPC.NOTION_GET_CONFIG_PATH),
    onFireTask: (callback: (payload: NotionFireTaskPayload) => void) => {
      const listener = (_e: unknown, payload: NotionFireTaskPayload) => callback(payload)
      ipcRenderer.on(IPC.NOTION_FIRE_TASK, listener)
      return () => ipcRenderer.removeListener(IPC.NOTION_FIRE_TASK, listener)
    },
  },

}

export type ApiType = typeof api

contextBridge.exposeInMainWorld('api', api)

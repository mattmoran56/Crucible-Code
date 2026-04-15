import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { Project, Session, Commit, FileDiff, PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod, UpdateStatus, Note, PRDetail, PRConversationComment, PRCheck, PRReviewThread, SessionUsage, UsageStats, SubscriptionInfo, FileEntry, FileStat, ClaudeAccount, ConfigItem, ConfigTrackingMode, CustomButton, CustomButtonGroup, ButtonActionType, ButtonExecutionMode } from '../shared/types'

const api = {
  git: {
    status: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_STATUS, repoPath),
    log: (repoPath: string, maxCount?: number): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC.GIT_LOG, repoPath, maxCount),
    diff: (repoPath: string, commitHash: string): Promise<FileDiff[]> =>
      ipcRenderer.invoke(IPC.GIT_DIFF, repoPath, commitHash),
    fileDiff: (repoPath: string, commitHash: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_FILE_DIFF, repoPath, commitHash, filePath),
    checkout: (repoPath: string, branch: string): Promise<{ stashed: boolean; detachedWorktree?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.GIT_CHECKOUT, repoPath, branch),
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
    isMerged: (worktreePath: string, baseBranch: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.GIT_IS_MERGED, worktreePath, baseBranch),
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
    spawn: (sessionId: string, cwd: string, mode?: 'shell' | 'claude' | 'review', claudeTheme?: string, claudeConfigDir?: string, repoPath?: string, resume?: boolean): Promise<string> =>
      ipcRenderer.invoke(IPC.TERMINAL_SPAWN, sessionId, cwd, mode, claudeTheme, claudeConfigDir, repoPath, resume),
    write: (terminalId: string, data: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_WRITE, terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, terminalId, cols, rows),
    kill: (terminalId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, terminalId),
    killSession: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL_SESSION, sessionId),
    getRecoveryList: (): Promise<Array<{ terminalId: string; sessionId: string; mode: 'shell' | 'claude' | 'review'; cwd: string; claudeTheme: string; claudeConfigDir?: string; repoPath?: string }>> =>
      ipcRenderer.invoke(IPC.TERMINAL_RECOVERY_LIST),
    onData: (callback: (terminalId: string, data: string) => void) => {
      const listener = (_e: any, terminalId: string, data: string) => callback(terminalId, data)
      ipcRenderer.on(IPC.TERMINAL_DATA, listener)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, listener)
    },
    onExit: (callback: (terminalId: string, exitCode: number) => void) => {
      const listener = (_e: any, terminalId: string, exitCode: number) =>
        callback(terminalId, exitCode)
      ipcRenderer.on(IPC.TERMINAL_EXIT, listener)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_EXIT, listener)
    },
  },

  notification: {
    show: (title: string, body: string) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_SHOW, title, body),
    getPort: (): Promise<number | null> => ipcRenderer.invoke(IPC.NOTIFICATION_GET_PORT),
    triggerForSession: (sessionId: string, sessionName: string, hookType?: string) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_HOOK_EVENT, sessionId, sessionName, hookType),
    onSessionStatus: (callback: (sessionId: string, hookType: string) => void) => {
      const listener = (_e: any, sessionId: string, hookType: string) => callback(sessionId, hookType)
      ipcRenderer.on(IPC.NOTIFICATION_SESSION_STATUS, listener)
      return () => ipcRenderer.removeListener(IPC.NOTIFICATION_SESSION_STATUS, listener)
    },
    registerSession: (
      sessionId: string,
      sessionName: string,
      projectId: string,
      worktreePath: string
    ) =>
      ipcRenderer.invoke(
        'notification:register-session',
        sessionId,
        sessionName,
        projectId,
        worktreePath
      ),
    unregisterSession: (worktreePath: string) =>
      ipcRenderer.invoke('notification:unregister-session', worktreePath),
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
    apply: () => ipcRenderer.invoke(IPC.UPDATE_APPLY),
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

  config: {
    list: (repoPath: string): Promise<ConfigItem[]> =>
      ipcRenderer.invoke(IPC.CONFIG_LIST, repoPath),
    getContent: (repoPath: string, itemId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.CONFIG_GET_CONTENT, repoPath, itemId),
    setTracking: (repoPath: string, itemId: string, mode: ConfigTrackingMode): Promise<void> =>
      ipcRenderer.invoke(IPC.CONFIG_SET_TRACKING, repoPath, itemId, mode),
    createCommand: (repoPath: string, name: string, content: string): Promise<ConfigItem> =>
      ipcRenderer.invoke(IPC.CONFIG_CREATE_COMMAND, repoPath, name, content),
    createClaudeMd: (repoPath: string, location: 'root' | '.claude', content: string): Promise<ConfigItem> =>
      ipcRenderer.invoke(IPC.CONFIG_CREATE_CLAUDEMD, repoPath, location, content),
    delete: (repoPath: string, itemId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.CONFIG_DELETE, repoPath, itemId),
    updateContent: (repoPath: string, itemId: string, content: string): Promise<void> =>
      ipcRenderer.invoke(IPC.CONFIG_UPDATE_CONTENT, repoPath, itemId, content),
    onChanged: (callback: (repoPath: string, items: ConfigItem[]) => void) => {
      const listener = (_e: unknown, repoPath: string, items: ConfigItem[]) =>
        callback(repoPath, items)
      ipcRenderer.on(IPC.CONFIG_CHANGED, listener)
      return () => ipcRenderer.removeListener(IPC.CONFIG_CHANGED, listener)
    },
  },
}

export type ApiType = typeof api

contextBridge.exposeInMainWorld('api', api)

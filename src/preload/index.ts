import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants'
import type { Project, Session, Commit, FileDiff, PullRequest, PRFile, PRComment, PRReviewEvent, PRMergeMethod } from '../shared/types'

const api = {
  git: {
    status: (repoPath: string) => ipcRenderer.invoke(IPC.GIT_STATUS, repoPath),
    log: (repoPath: string, maxCount?: number): Promise<Commit[]> =>
      ipcRenderer.invoke(IPC.GIT_LOG, repoPath, maxCount),
    diff: (repoPath: string, commitHash: string): Promise<FileDiff[]> =>
      ipcRenderer.invoke(IPC.GIT_DIFF, repoPath, commitHash),
    fileDiff: (repoPath: string, commitHash: string, filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC.GIT_FILE_DIFF, repoPath, commitHash, filePath),
    checkout: (repoPath: string, branch: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_CHECKOUT, repoPath, branch),
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
    spawn: (sessionId: string, cwd: string, mode?: 'shell' | 'claude'): Promise<string> =>
      ipcRenderer.invoke(IPC.TERMINAL_SPAWN, sessionId, cwd, mode),
    write: (terminalId: string, data: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_WRITE, terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, terminalId, cols, rows),
    kill: (terminalId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, terminalId),
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
    triggerForSession: (sessionId: string, sessionName: string) =>
      ipcRenderer.invoke(IPC.NOTIFICATION_HOOK_EVENT, sessionId, sessionName),
    onHookEvent: (callback: (sessionId: string) => void) => {
      const listener = (_e: any, sessionId: string) => callback(sessionId)
      ipcRenderer.on(IPC.NOTIFICATION_HOOK_EVENT, listener)
      return () => ipcRenderer.removeListener(IPC.NOTIFICATION_HOOK_EVENT, listener)
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
  },

  focus: {
    setActiveContext: (projectId: string | null, sessionId: string | null) =>
      ipcRenderer.invoke(IPC.FOCUS_SET_ACTIVE_CONTEXT, projectId, sessionId),
  },

  project: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC.PROJECT_LIST),
    add: (project: Project): Promise<Project[]> => ipcRenderer.invoke(IPC.PROJECT_ADD, project),
    remove: (projectId: string): Promise<Project[]> =>
      ipcRenderer.invoke(IPC.PROJECT_REMOVE, projectId),
    selectFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.PROJECT_SELECT_FOLDER),
  },

  github: {
    listPRs: (repoPath: string): Promise<PullRequest[]> =>
      ipcRenderer.invoke(IPC.PR_LIST, repoPath),
    getSeenPRs: (projectId: string): Promise<number[]> =>
      ipcRenderer.invoke(IPC.PR_SEEN_GET, projectId),
    markPRSeen: (projectId: string, prNumber: number): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_SEEN_SET, projectId, prNumber),
    getDiff: (repoPath: string, prNumber: number): Promise<string> =>
      ipcRenderer.invoke(IPC.PR_DIFF, repoPath, prNumber),
    getFiles: (repoPath: string, prNumber: number): Promise<PRFile[]> =>
      ipcRenderer.invoke(IPC.PR_FILES, repoPath, prNumber),
    getComments: (repoPath: string, prNumber: number): Promise<PRComment[]> =>
      ipcRenderer.invoke(IPC.PR_COMMENTS, repoPath, prNumber),
    createComment: (
      repoPath: string,
      prNumber: number,
      body: string,
      path: string,
      line: number
    ): Promise<PRComment> =>
      ipcRenderer.invoke(IPC.PR_COMMENT_CREATE, repoPath, prNumber, body, path, line),
    submitReview: (
      repoPath: string,
      prNumber: number,
      event: PRReviewEvent,
      body?: string
    ): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_REVIEW, repoPath, prNumber, event, body),
    merge: (repoPath: string, prNumber: number, method: PRMergeMethod): Promise<void> =>
      ipcRenderer.invoke(IPC.PR_MERGE, repoPath, prNumber, method),
  },

  session: {
    list: (projectId: string): Promise<Session[]> =>
      ipcRenderer.invoke(IPC.SESSION_LIST, projectId),
    save: (projectId: string, sessions: Session[]) =>
      ipcRenderer.invoke(IPC.SESSION_SAVE, projectId, sessions),
  },
}

export type ApiType = typeof api

contextBridge.exposeInMainWorld('api', api)

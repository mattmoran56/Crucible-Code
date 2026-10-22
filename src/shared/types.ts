export interface ClaudeAccount {
  id: string
  label: string
  configDir: string
}

export interface Project {
  id: string
  name: string
  repoPath: string
  claudeAccountId?: string
  /**
   * Where new sessions run by default. `undefined` means CLOUD: the user wants
   * Claude Code on the web to be the default so local CI/test load stays off
   * their machine. This is a deliberate exception to the usual "optional
   * features default off" rule — only an explicit 'local' opts out.
   */
  defaultSessionLocation?: SessionLocation
  /** Sandboxer integration (one container per worktree). Off unless set. */
  sandboxer?: SandboxerProjectConfig
}

/** Per-project Sandboxer settings. */
export interface SandboxerProjectConfig {
  enabled: boolean
  /**
   * The project's `sandboxer.yaml`. Relative paths resolve against the repo
   * root; unset means `sandboxer.yaml` at the repo root. It is copied into each
   * worktree that does not track its own, so a config kept out of git (e.g.
   * listed in `.git/info/exclude`) still reaches every session.
   */
  configPath?: string
}

/** Whether a project's Sandboxer config can be found, and how git sees it. */
export interface SandboxerConfigCheck {
  /** Absolute path the config resolves to. */
  path: string
  exists: boolean
  /** tracked: committed; ignored: kept out of git; untracked: neither. */
  gitState: 'tracked' | 'ignored' | 'untracked' | 'outside-repo' | 'unknown'
  /** `sandboxer version`, or null when the CLI is not installed. */
  cliVersion: string | null
}

/** One sandbox as `sandboxer ls/status --json` reports it. */
export interface SandboxInfo {
  project: string
  slug: string
  branch: string
  worktree: string
  /** running | stopped | starting | degraded | ... (whatever sandboxer says). */
  state: string
  container: string
  ttl?: string
  urls?: Record<string, string>
  /** Whether each URL answers yet, keyed like `urls` (filled in by status). */
  links?: Record<string, SandboxLinkState>
}

/**
 * ready: the app answers. starting: nothing listening yet (502/504/no
 * connection). not-built: a front-end sandboxer has not built in this sandbox.
 */
export type SandboxLinkState = 'ready' | 'starting' | 'not-built'

/** A long-running sandboxer command started from the Sandbox panel. */
export interface SandboxJob {
  worktreePath: string
  /** What the panel calls it, e.g. "Starting sandbox" or "Building app". */
  title: string
  state: 'running' | 'succeeded' | 'failed'
  /** Output lines, newest last (capped). */
  lines: string[]
  /** The most recent `==>` step sandboxer printed. */
  step: string | null
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
}

/** What tearing down a worktree's sandboxes did. */
export interface SandboxTeardownReport {
  /** `project/slug` of every sandbox that is gone. */
  removed: string[]
  /** `project/slug: reason` for any that could not be removed. */
  failed: string[]
  /** Set when sandboxer could not be asked at all (CLI missing, Docker down). */
  skipped?: string
}

/** Where a session's agent runs: Claude Code on the web, or on this machine. */
export type SessionLocation = 'cloud' | 'local'

/** The Claude Code on the web session a cloud session is bound to. */
export interface CloudSessionLink {
  /** Cloud session id (e.g. `session_...`). */
  sessionId: string
  /** https://claude.ai/code/... URL for the session. */
  url: string
  /**
   * ISO time a teleport down to the local worktree started. The session only
   * really is local once the teleported conversation was found on disk
   * (`visualAgents.agent`); until then the teleport may be abandoned and the
   * session goes back to the cloud (lib/teleportRecovery).
   */
  teleportedAt?: string
  /**
   * Set once we have tried to find the local Claude session a teleport wrote,
   * so a failed discovery is not retried (and re-noticed) on every launch.
   */
  localResumeResolved?: boolean
  /**
   * A teleport was started but abandoned before Claude saved anything locally
   * (interactive `claude --teleport` only writes a transcript after the first
   * message), so the session went back to the cloud. The Agent tab says so and
   * offers to teleport again; cleared by the next teleport.
   */
  teleportIncomplete?: boolean
  /** The branch the cloud agent was told to work on and push to. */
  branch?: string
}

/** Result of creating a cloud session or queuing a message to one. */
export interface CloudSessionResult {
  sessionId: string
  url: string
  /** The branch the cloud agent was told to use (set by create). */
  branch?: string
}

/**
 * A cloud session whose cloud side has not been created yet. Creation is
 * interactive (`claude --cloud <task>` in a PTY in the Agent tab), so the
 * session is saved first and the Agent tab drives the CLI until it prints the
 * new session's URL; then `cloud` is set and this is cleared.
 */
export interface CloudSessionPending {
  /** The task the cloud session starts with (without the branch instruction). */
  task: string
  /** The branch the cloud agent is told to work on and push to. */
  branch: string
  /** ISO time the session was saved as pending. */
  createdAt: string
}

/** Where an interactive cloud create run is. */
export type CloudCreateStatus = 'running' | 'created' | 'failed'

/** Snapshot of one interactive cloud create run (main process → renderer). */
export interface CloudCreateState {
  /** App session id. */
  sessionId: string
  projectId: string
  /** The PTY running `claude --cloud …`; null before it starts. */
  terminalId: string | null
  status: CloudCreateStatus
  /** Set once the CLI printed the new session. */
  result?: CloudSessionResult
  /** Why the run failed (CLI output tail, push error, …). */
  error?: string
  /** The CLI was cancelled after sending the create request: a session may exist on claude.ai/code. */
  mayExist?: boolean
  /** The local CLI process is still running. */
  attached: boolean
}

/** Result of asking to teleport a cloud session down to its worktree. */
export type CloudTeleportResult =
  | { ok: true; terminalId: string; state: CloudTeleportState }
  | { ok: false; reason: 'dirty'; files: string[] }

/**
 * Where a teleport run is:
 * - running: `claude --teleport <id>` is pulling the session down (PTY)
 * - needs-input: the CLI is asking something; the user answers in the terminal
 * - finishing: the conversation is local; the PTY is being closed
 * - done: `claudeSessionId` is the local Claude session to resume visually
 * - failed: see `error` (the PTY's scrollback stays available)
 */
export type CloudTeleportStatus = 'running' | 'needs-input' | 'finishing' | 'done' | 'failed'

/**
 * Why a `needs-input` run is waiting on the user:
 * - prompt: the CLI is showing a dialog/menu (stash, trust, sign-in, …)
 * - first-message: the REPL has the conversation loaded but Claude Code only
 *   saves a teleported conversation to disk once it changes (2.1.306), so
 *   there is no transcript to resume yet; the user can carry on in the
 *   terminal; once a transcript exists "Open in Agent view" picks it up
 *   (until then the only way out is "Cancel teleport", which abandons it)
 * - timeout: no progress for a long time; the terminal shows what is going on
 */
export type CloudTeleportWaiting = 'prompt' | 'first-message' | 'timeout'

/** Snapshot of one teleport run (main process → renderer). */
export interface CloudTeleportState {
  /** App session id. */
  sessionId: string
  /** The app session's project (so a run finishing in another project still lands). */
  projectId?: string
  /** The PTY running `claude --teleport …`. */
  terminalId: string
  status: CloudTeleportStatus
  /** Progress lines the CLI printed, oldest first (e.g. "Fetching session logs"). */
  steps: string[]
  /** ISO time the teleport started (transcript discovery looks from here). */
  startedAt: string
  /** The local Claude session the teleport wrote, once found. */
  claudeSessionId?: string
  /** Set with `needs-input`: what the run is waiting for. */
  waiting?: CloudTeleportWaiting
  error?: string
}

export type SessionStatus = 'running' | 'attention' | 'completed'
export type HookType = 'prompt' | 'notification' | 'stop'
export type ContextKind = 'session' | 'code' | 'pr'

export interface NotionTicketLink {
  pageId: string
  url: string
  title: string
}

export interface Session {
  id: string
  name: string
  branchName: string
  worktreePath: string
  projectId: string
  createdAt: string
  lastActiveAt?: string
  prNumber?: number
  baseBranch?: string
  notionTicket?: NotionTicketLink
  /**
   * Visual agents in this session keyed by workspace tab id ('agent' for the
   * core tab, 'agent:N' for dynamic ones, or 'visual-agent:N' for tabs opened
   * before agents were always visual). Persisted so a restart of the
   * app resumes the same Claude conversation on the same model.
   */
  visualAgents?: Record<string, { claudeSessionId: string; model: string }>
  /** Where the agent runs. Missing means local (every session before cloud sessions). */
  location?: SessionLocation
  /** The cloud session behind this session, kept after a teleport for reference. */
  cloud?: CloudSessionLink
  /** Set while the cloud session is being created (location 'cloud', no `cloud` yet). */
  cloudPending?: CloudSessionPending
  /**
   * True when the app created `branchName` (via createWorktree), so removing
   * the session may delete it even when it does not use the `session/` prefix.
   */
  ownsBranch?: boolean
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

export type CIStatus = 'success' | 'failure' | 'pending' | 'none'

export interface PRLabel {
  name: string
  color: string
  description?: string
}

export interface PullRequest {
  number: number
  title: string
  headRefName: string
  baseRefName: string
  author: string
  assignees: string[]
  requestedReviewers: string[]
  createdAt: string
  updatedAt: string
  isDraft: boolean
  state: 'OPEN' | 'MERGED'
  ciStatus: CIStatus
  labels: PRLabel[]
  commentsCount: number
  reviews: PRReviewSummary[]
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
  startLine?: number | null
  side: 'LEFT' | 'RIGHT'
  author: string
  createdAt: string
  inReplyToId?: number | null
}

export type PRReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'PENDING'
  | 'DISMISSED'

export interface PRReviewSummary {
  author: string
  state: PRReviewState
  submittedAt: string
}

export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export interface PRDetail {
  body: string
  author: string
  title: string
  createdAt: string
  baseRefName: string
  headRefName: string
  baseRefOid?: string
  headRefOid?: string
  requestedReviewers: string[]
  reviews: PRReviewSummary[]
}

export interface GitHubCollaborator {
  login: string
  avatarUrl?: string
}

export interface PRConversationComment {
  id: number
  body: string
  author: string
  createdAt: string
  authorAssociation: string
}

export interface PRCheck {
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending'
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped' | 'stale' | null
  startedAt: string | null
  completedAt: string | null
  detailsUrl: string | null
}

export interface PRReviewThread {
  id: string
  path: string
  line: number | null
  startLine?: number | null
  side?: 'LEFT' | 'RIGHT'
  isResolved: boolean
  rootCommentId?: number | null
  comments: PRComment[]
}

export type PRReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export type PRMergeMethod = 'merge' | 'squash' | 'rebase'

export interface UpdateStatus {
  state: 'idle' | 'available' | 'updating' | 'error'
  commitCount?: number
  error?: string
  builtCommit?: string
}

// Usage tracking

export interface RateLimitWindow {
  usedPercentage: number // 0-100
  resetsAt: number // unix epoch seconds
}

export interface SessionUsage {
  sessionId: string
  rateLimits?: {
    fiveHour?: RateLimitWindow
    sevenDay?: RateLimitWindow
  }
  cost: {
    totalCostUsd: number
    totalDurationMs: number
    totalApiDurationMs: number
    totalLinesAdded: number
    totalLinesRemoved: number
  }
  updatedAt: number
}

export interface DailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export interface UsageStats {
  dailyActivity: DailyActivity[]
  totalSessions: number
  totalMessages: number
}

export interface SubscriptionInfo {
  subscriptionType: string | null
  rateLimitTier: string | null
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface FileStat {
  size: number
  exists: boolean
}

// Custom Buttons

export type ButtonPlacement = 'session-toolbar' | 'project-tabs' | 'right-activity-bar'
export type ButtonActionType = 'shell' | 'claude' | 'app-action'

export type AppAction =
  // Session actions
  | 'session:open-as-main'
  | 'session:return-to-worktree'
  | 'session:delete'
  | 'session:create'
  // Tab actions
  | 'tab:open-agent'
  | 'tab:open-terminal'
  | 'tab:switch-agent'
  | 'tab:switch-git'
  | 'tab:switch-pr'
  | 'tab:switch-review'
  | 'tab:switch-code'
  | 'tab:split-right'
  // Project actions
  | 'project:add'
  | 'project:remove'
  // App actions
  | 'app:open-settings'
  | 'app:toggle-notes'
  | 'app:toggle-usage'
  // Review loop
  | 'review-loop:start'
  | 'review-loop:cancel'
  | 'review-loop:toggle-tab'
export type ButtonExecutionMode = 'terminal' | 'background'

export type ButtonScope =
  | { type: 'global' }
  | { type: 'all-projects' }
  | { type: 'projects'; projectIds: string[] }

export interface CustomButton {
  id: string
  label: string
  icon?: string
  placement: ButtonPlacement
  actionType: ButtonActionType
  executionMode: ButtonExecutionMode
  command: string
  cwd?: string
  scope: ButtonScope
  order: number
  groupId?: string
  confirmMessage?: string
  shortcut?: string
}

export interface CustomButtonGroup {
  id: string
  label: string
  icon?: string
  placement: ButtonPlacement
  scope: ButtonScope
  order: number
}

// Session Startup Prompts
//
// A prompt that can be optionally selected in the New Session dialog and is
// auto-typed into the agent terminal once Claude is ready. The presence of
// `{{input}}` in `command` is what tells the dialog to render an input field.

export interface StartupPrompt {
  id: string
  label: string
  command: string
  inputLabel?: string
  inputPlaceholder?: string
  order: number
}

// Review Loop ────────────────────────────────────────────────────────────────

export type ReviewLoopPhase =
  | 'idle'
  | 'review'
  | 'triage'
  | 'fix'
  | 'pr-update'
  | 'cooldown'

export type ReviewLoopStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'error'

export type ReviewLoopStopReason =
  | 'converged'
  | 'maxIterations'
  | 'cancelled'
  | 'error'

export type ReviewLoopDecision = 'fix' | 'skip' | 'defer' | 'noop'

export interface ReviewLoopIssue {
  id: string
  title: string
  description: string
  file?: string
  line?: number
  category?: string
}

export interface ReviewLoopTriagedIssue extends ReviewLoopIssue {
  introducedInPR: boolean
  decision: ReviewLoopDecision
  justification: string
}

export type ReviewLoopVariant = 'pro' | 'lite' | 'efficient'

/** Lifecycle of a single foreground phase terminal within a round. */
export type ReviewLoopPhaseStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'skipped'

/**
 * One foreground phase of a round. Each phase is an independent, interactive
 * `claude` PTY the user can watch and type into; when its turn finishes the
 * terminal is frozen (read-only) and the next phase begins.
 */
export interface ReviewLoopPhaseSlot {
  phase: 'review' | 'triage' | 'fix'
  status: ReviewLoopPhaseStatus
  /** Terminal id of the live (or frozen) claude PTY backing this phase. */
  terminalId?: string
  /** Workspace tab id used for hook routing + renderer attach (e.g. `review-loop:r1:review`). */
  tabId?: string
  /**
   * Headless-only: streamed transcript lines for this phase. When the loop runs
   * with `headless: true` there is no PTY/`terminalId`; the panel renders these
   * lines read-only instead of an xterm.
   */
  transcript?: string[]
  startedAt?: string
  endedAt?: string
  errorMessage?: string
}

export interface ReviewLoopRound {
  index: number
  startedAt: string
  endedAt?: string
  phase: ReviewLoopPhase
  /**
   * The foreground phase terminals for this round (review, triage, fix),
   * rendered as live columns. Replaces the old headless transcript capture.
   */
  phaseSlots: ReviewLoopPhaseSlot[]
  /** Pro-only: structured issues from review phase. Empty for Lite. */
  rawIssues: ReviewLoopIssue[]
  /** Pro-only: triaged issues. Empty for Lite. */
  triaged: ReviewLoopTriagedIssue[]
  log: string[]
  errorMessage?: string
}

export interface ReviewLoopState {
  sessionId: string
  branch: string
  baseBranch: string
  worktreePath: string
  variant: ReviewLoopVariant
  status: ReviewLoopStatus
  currentPhase: ReviewLoopPhase
  iteration: number
  rounds: ReviewLoopRound[]
  startedAt?: string
  endedAt?: string
  stopReason?: ReviewLoopStopReason
  errorMessage?: string
  /** Pro-only: items the loop chose not to fix; surfaced in sticky PR comment. Empty for Lite. */
  skippedIssues: ReviewLoopTriagedIssue[]
  /**
   * Efficient-only: the single long-lived interactive `claude` PTY that runs
   * triage + implementation for every round (the right-hand panel). Its
   * conversation/context persists across rounds. Unused by Lite/Pro.
   */
  persistentTerminalId?: string
  /** Efficient-only: workspace tab id of {@link persistentTerminalId}. */
  persistentTabId?: string
}

export interface ReviewLoopConfig {
  enabled: boolean
  /**
   * Lite (default): unstructured, /review-driven handoff. Pro: structured
   * 3-phase pipeline with JSON intermediates and PR comments. Both run as three
   * live foreground terminal columns per round. Efficient: fresh headless
   * reviews (stacked, left) hand off to one persistent interactive worker
   * (right) that triages + implements every round, keeping context across the
   * loop — cheaper than re-paying fresh context for triage/fix each round.
   */
  variant: ReviewLoopVariant
  maxIterations: number
  consecutiveCleanRounds: number
  /**
   * When true (default), each phase runs as a headless `claude -p` subprocess
   * (no PTY) and streams its transcript into the panel — avoids the macOS PTY
   * limit. When false, each phase runs as a live, interactive foreground
   * terminal the user can watch and type into. Either way: no bypass / no
   * `--permission-mode acceptEdits`; headless inherits the user's auto default.
   * Ignored by the Efficient variant, whose topology is fixed (headless
   * reviews + one interactive worker).
   */
  headless: boolean
}

export interface ReviewLoopProjectOverride {
  enabled?: boolean
  variant?: ReviewLoopVariant
  maxIterations?: number
  consecutiveCleanRounds?: number
  headless?: boolean
}

export interface ReviewLoopSettings {
  workspace: ReviewLoopConfig
  projectOverrides: Record<string, ReviewLoopProjectOverride>
}

export const DEFAULT_REVIEW_LOOP_CONFIG: ReviewLoopConfig = {
  enabled: true,
  variant: 'lite',
  maxIterations: 5,
  consecutiveCleanRounds: 2,
  headless: true,
}

// Scheduler ──────────────────────────────────────────────────────────────────

export interface QueuedSession {
  id: string
  projectId: string
  name: string
  baseBranch?: string
  startupPrompt: string
  scheduledFor: number       // unix ms
  createdAt: string
}

export type QueuedMessageReason = 'usage-reset' | 'manual'

export interface QueuedMessage {
  id: string
  sessionId: string
  message: string
  scheduledFor: number       // unix ms
  createdAt: string
  reason: QueuedMessageReason
}

export interface UsageLimitEvent {
  sessionId: string
  resetsAt: number           // unix seconds, mirrors RateLimitWindow.resetsAt
}

// Notion task integration ────────────────────────────────────────────────────

export type NotionPropertyType =
  | 'select'
  | 'status'
  | 'checkbox'
  | 'rich_text'
  | 'title'
  | 'number'
  | 'date'
  | 'url'
  | 'people'
  | 'multi_select'
  | 'relation'
  | 'formula'
  | 'rollup'

export type NotionFilterOperator =
  | 'equals'
  | 'does_not_equal'
  | 'contains'
  | 'does_not_contain'
  | 'is_empty'
  | 'is_not_empty'

export interface NotionPropertyFilter {
  property: string
  type: NotionPropertyType
  operator: NotionFilterOperator
  // Omitted for is_empty / is_not_empty.
  value?: string | number | boolean
  // For type='relation', either pick a single related page by id (set `value`)
  // OR filter by a property on the related page (set `relationDatabaseId` and
  // `subFilter`). When `subFilter` is present, the poller resolves it at query
  // time by first querying the related DB for matching page ids, then
  // expanding the outer filter into an `or` of relation.contains over each id.
  // Notion's API doesn't support this natively — it's resolved client-side.
  relationDatabaseId?: string
  subFilter?: NotionPropertyFilter
  // For type='formula', the result type of the formula (e.g. 'boolean'). Notion
  // formula filters nest the operator under this — see NotionDatabaseProperty.
  formulaResultType?: 'boolean' | 'number' | 'date' | 'string'
}

export interface NotionPropertyUpdate {
  property: string
  type: NotionPropertyType
  // Supports placeholders: {{branch}}, {{sessionId}}, {{taskUrl}}, {{taskTitle}}, {{taskId}}, {{taskTitleSlug}}
  value: string
}

export interface NotionIntegrationConfig {
  enabled: boolean
  apiToken: string
  databaseId: string
  // Legacy single-group AND filter. Kept for backward compatibility with
  // existing configs (and the MCP setup prompts). If `filterGroups` is set
  // and non-empty, it takes precedence and `filters` is ignored.
  filters: NotionPropertyFilter[]
  // OR of ANDs: each group's conditions are ANDed together, and the groups
  // are ORed. Empty/missing = fall back to `filters`. When the user defines
  // a single group via the UI it's still written to `filters` to minimise
  // JSON churn for the common case.
  filterGroups?: NotionPropertyFilter[][]
  // Updates applied on pickup. Splits into two passes inside the service: ones
  // that don't reference {{branch}}/{{sessionId}} run immediately (so the next
  // poll tick won't re-fire the page), the rest run after the renderer creates
  // the session and calls applyWriteBack.
  pickupUpdates: NotionPropertyUpdate[]
  // Optional markdown appended as paragraph blocks to the page on pickup. Runs
  // in the second (post-session) pass so {{branch}}/{{sessionId}} can be used.
  pickupAppendMarkdown?: string
  // Startup prompt typed into the new Claude terminal. Supports the same
  // placeholders as pickupUpdates.
  startupPromptTemplate: string
  // Defaults to whichever property is type 'title' in the DB schema.
  titlePropertyName?: string
  // Defaults to "notion/{{taskTitleSlug}}".
  branchNameTemplate?: string
}

export interface NotionDatabasePropertyOption {
  id: string
  name: string
  color?: string
}

export interface NotionDatabaseProperty {
  name: string
  type: NotionPropertyType | string
  // Populated for 'select', 'status', 'multi_select'.
  options?: NotionDatabasePropertyOption[]
  // Populated for 'relation' — id of the related database.
  relationDatabaseId?: string
  // Populated for 'formula' — the computed result type. Filtering by a formula
  // in Notion requires nesting the operator under this type (e.g. for a
  // boolean formula: `{ formula: { boolean: { equals: true } } }`).
  formulaResultType?: 'boolean' | 'number' | 'date' | 'string'
}

export interface NotionRelationOption {
  id: string
  title: string
}

export interface NotionUser {
  id: string
  name: string
  avatarUrl?: string
}

export interface NotionDatabaseSchema {
  id: string
  title: string
  titlePropertyName: string
  properties: NotionDatabaseProperty[]
}

export interface NotionTaskPayload {
  id: string
  url: string
  title: string
  // Raw properties for placeholder resolution and UI display.
  rawProperties: Record<string, unknown>
}

export interface NotionFireTaskPayload {
  projectId: string
  page: NotionTaskPayload
  resolvedStartupPrompt: string
  suggestedBranchName: string
  suggestedSessionName: string
}

export interface NotionTestConnectionResult {
  ok: boolean
  taskCount?: number
  error?: string
}

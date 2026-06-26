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
  claudeWebEnabled?: boolean
  claudeWebBranchPrefix?: string
}

export interface ClaudeWebSession {
  branchName: string
  headSha: string
  lastCommitDate: string
  authorName: string
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
   * When on, this session's terminals run with the local-PR `gh` shim on PATH,
   * so a `gh pr create` the agent runs is captured into a local PR record
   * instead of opening a real GitHub PR. See `gh-shim.service.ts`.
   */
  captureLocalPr?: boolean
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
  /**
   * Set when this list entry is a local PR (not yet on GitHub). The renderer
   * uses it to show a "Local" badge, route the detail view at local git, and
   * offer "Promote to PR" instead of remote-only actions. `number` for a local
   * entry is the negative of its `localNumber` so it never collides with a real
   * PR number. Absent/undefined for normal remote PRs.
   */
  isLocal?: boolean
  localPrId?: string
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
  | 'app:toggle-permissions'
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

export type ReviewLoopVariant = 'pro' | 'lite'

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
}

export interface ReviewLoopConfig {
  enabled: boolean
  /** Lite (default): unstructured, /review-driven handoff. Pro: structured 3-phase pipeline with JSON intermediates and PR comments. Both run as three live foreground terminal columns per round. */
  variant: ReviewLoopVariant
  maxIterations: number
  consecutiveCleanRounds: number
  /**
   * When true (default), each phase runs as a headless `claude -p` subprocess
   * (no PTY) and streams its transcript into the panel — avoids the macOS PTY
   * limit. When false, each phase runs as a live, interactive foreground
   * terminal the user can watch and type into. Either way: no bypass / no
   * `--permission-mode acceptEdits`; headless inherits the user's auto default.
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

// Foundry — autopilot orchestrator over a Notion task set ───────────────────

export type FoundryWorkerPermissionMode = 'bypassPermissions' | 'acceptEdits' | 'default'

export interface FoundryCompletionTransition {
  /** Property name (typically a status property) the foundry watches for moves. */
  property: string
  fromValue?: string
  toValue: string
}

export interface FoundryConfig {
  id: string
  name: string
  projectId: string
  enabled: boolean
  paused?: boolean
  notionOverride?: {
    apiToken?: string
    databaseId?: string
    titlePropertyName?: string
  }
  taskSetFilters: NotionPropertyFilter[][]
  eligibilityFilters?: NotionPropertyFilter[]
  completionTransition: FoundryCompletionTransition
  /** Statuses the foreman should treat as "dependency satisfied" (e.g. ["Done", "Testing"]). */
  completedStatuses?: string[]
  pickupUpdates: NotionPropertyUpdate[]
  readyForReviewUpdates: NotionPropertyUpdate[]
  /** Default `/notion-ticket {{taskUrl}}`. */
  implementCommandTemplate: string
  /**
   * Optional slash command (e.g. `/finalize-ticket {{taskUrl}}`) run as a
   * fresh headless claude on the worktree AFTER the review loop converges
   * and BEFORE the PR is marked ready / Notion gets the ready-for-review
   * updates. Blank = skip.
   */
  readyForReviewCommandTemplate?: string
  /** Default `foundry/{{taskTitleSlug}}`. */
  branchNameTemplate?: string
  baseBranch?: string
  maxConcurrentTasks: number
  workerPermissionMode: FoundryWorkerPermissionMode
  reviewLoopOverride?: ReviewLoopProjectOverride
  /** Default `attention`. */
  onReviewNonConvergence?: 'attention' | 'proceed'
  implementTimeoutMinutes?: number
  foremanCostCapUsd?: number
  /** Also trigger a foreman pass when a task transitions directly to a completedStatus. Default true. */
  triggerOnCompletedStatusEnter?: boolean
  /**
   * Optimistic continue. When on, dependency tickets sitting in an
   * `optimisticStatuses` state (PR open but NOT yet merged to trunk, e.g.
   * "In review") are treated as dependency-satisfied: the foreman picks up the
   * next ticket they unblock, and the worker merges those still-open PR branches
   * into its own branch before implementing. Default off — normal behaviour
   * waits for dependencies to reach a `completedStatuses` (on-trunk) state.
   */
  optimisticContinue?: boolean
  /**
   * Statuses that count as "optimistically satisfied but not yet on trunk" — a
   * dependency in one of these has an open PR whose branch must be merged into
   * the dependent ticket. Only consulted when `optimisticContinue` is on.
   * Defaults to `['In review']`.
   */
  optimisticStatuses?: string[]
  /**
   * Local-PR mode. When on, workers produce LOCAL PRs (the gh shim captures
   * their `gh pr create`) instead of opening real GitHub PRs, building a chained
   * stack the user publishes later via "Create PRs". Default off.
   */
  localPrMode?: boolean
  /**
   * Integration branch every local PR in a run branches off. Default
   * `foundry/integration-<id>`. Tickets run in parallel off this branch; the
   * stack is assembled in completion order and conflicts are resolved at
   * publish/propagate (see {@link stackMode}).
   */
  foundryBranch?: string
  /**
   * How a local-PR-mode run feeds a managed PR stack. `new` (default) creates
   * one stack per foundry; `existing` appends completed local PRs to
   * {@link stackTargetStackId}; `none` produces local PRs without grouping them.
   * Only consulted when `localPrMode` is on.
   */
  stackMode?: 'new' | 'existing' | 'none'
  /** Target stack id when `stackMode === 'existing'`. */
  stackTargetStackId?: string
  /**
   * Custom prompt injected when Claude resolves a merge conflict while
   * publishing/propagating this foundry's stack. Supports `{{entryBranch}}`,
   * `{{belowBranch}}`, and `{{files}}` placeholders. Blank = built-in default.
   */
  stackConflictPrompt?: string
  /** Local CI runner config used by the publisher between promotes (Phase 6). */
  localCi?: {
    enabled: boolean
    runner: 'act'
    image?: string
    command?: string
    workflowFilter?: string
    timeoutMinutes?: number
  }
}

export type FoundryPipelinePhase =
  | 'spawn-requested'
  | 'implementing'
  | 'reviewing'
  | 'finalizing'
  | 'done'
  | 'cancelled'
  | 'orphaned'

export interface FoundryPipelineAttention {
  reason: string
  since: string
}

export interface FoundryPipeline {
  id: string
  foundryId: string
  page: NotionTaskPayload
  phase: FoundryPipelinePhase
  attention?: FoundryPipelineAttention
  sessionId?: string
  branch?: string
  worktreePath?: string
  baseBranch?: string
  prNumber?: number
  prUrl?: string
  /** Chained-stack predecessor (local-PR mode). */
  parentPipelineId?: string
  /** The local PR captured/produced for this pipeline (local-PR mode). */
  localPrId?: string
  startedAt: string
  updatedAt: string
  log: string[]
}

export type FoundryPassTrigger =
  | 'enabled'
  | 'manual'
  | 'transition'
  | 'slot-freed'
  | 'startup'
  | 'safety-net'

export type FoundryPassStatus = 'running' | 'completed' | 'error' | 'aborted'

export interface FoundryPassRecord {
  index: number
  startedAt: string
  endedAt?: string
  status: FoundryPassStatus
  trigger: FoundryPassTrigger
  claudeSessionId?: string
  costUsd?: number
  summary?: string
  startedPageIds: string[]
  transcript: string[]
  errorMessage?: string
}

export interface FoundryRuntimeState {
  foundryId: string
  pageStatusSnapshot: Record<string, string>
  documentedHashes: Record<string, string>
  planMarkdownHash?: string
  pipelines: FoundryPipeline[]
  passes: FoundryPassRecord[]
  passInFlight?: boolean
  lastError?: string
  /**
   * The claude session id the foreman uses across passes. Persisted so each
   * pass can `--resume` and inherit the conversation history (memory of
   * previous decisions). Set on the first successful pass; reset only on
   * explicit user action.
   */
  foremanClaudeSessionId?: string
  /**
   * Live PTY id when a pass is currently running (an interactive `claude`
   * terminal the foreman is driving — the user can also type into it). Set
   * when the pass starts; cleared when the foreman writes decision.json or
   * the pass times out.
   */
  foremanTerminalId?: string
  /**
   * Resumable cursor for the "Create PRs" batch publisher (local-PR mode). The
   * local PRs themselves live in the separate `local-prs.json` store; this only
   * tracks where the sequential walk is.
   */
  publish?: {
    status: 'idle' | 'running' | 'paused' | 'done' | 'error'
    currentLocalPrId?: string
    startedAt?: string
    log: string[]
  }
}

export interface ForemanDecision {
  planMarkdown?: string
  ticketNotes?: Array<{ pageId: string; comment: string; dependsOn?: string[] }>
  start: Array<{
    pageId: string
    reason: string
    /** `feat/`, `fix/`, `refactor/`, etc. prefix + short kebab-case slug. */
    branchName?: string
    /** Short kebab-case session label shown in the sidebar. */
    sessionName?: string
    /**
     * Optimistic-continue only: pageIds of this task's dependencies that are
     * currently in an `optimisticStatuses` state (PR open, not yet on trunk).
     * The FSM resolves each to its PR branch and has the worker merge them in
     * before implementing. Ignored when `optimisticContinue` is off.
     */
    optimisticDependsOn?: string[]
  }>
  blocked?: Array<{ pageId: string; reason: string }>
  summary: string
}

export interface FoundryFireTaskPayload {
  foundryId: string
  pipelineId: string
  projectId: string
  page: NotionTaskPayload
  resolvedImplementPrompt: string
  suggestedBranchName: string
  suggestedSessionName: string
  baseBranch?: string
  workerPermissionMode: FoundryWorkerPermissionMode
  claudeAccountConfigDir?: string
  /**
   * Local-PR mode: when set, the renderer registers capture intent for the
   * worker's context before spawning so its `gh pr create` becomes a local PR
   * linked to this pipeline. Carries the chained-stack metadata.
   */
  localPrCapture?: {
    foundryId: string
    pipelineId: string
    order: number
  }
}

export interface FoundryTaskStartedAck {
  pipelineId: string
  sessionId: string
  branch: string
  worktreePath: string
  baseBranch?: string
}

export type FoundryPipelineAction =
  | 'cancel'
  | 'resume'
  | 'retry-phase'
  | 'skip-phase'

// Local PRs — a session-level stage between a draft branch and an open GitHub
// PR. A local PR is a tracked record of a would-be pull request that lives on
// the user's machine; it can be viewed/reviewed and then *promoted* to a real
// GitHub PR. Produced manually from any session ("Create local PR") or by
// capturing a worker's `gh pr create` (see gh-shim). Foundry is the biggest
// consumer: an overnight run yields a chained stack of local PRs. ────────────

export type LocalPRStatus =
  | 'local' // captured/created, branch pushed, viewable & promotable
  | 'promoting' // promote in progress
  | 'open' // promoted → real GitHub PR open
  | 'ci-running'
  | 'ci-passed'
  | 'ci-failed'
  | 'merged'
  | 'error'

export interface LocalPRCIResult {
  status: CIStatus
  checks: PRCheck[]
  ranAt: string
  runner: string
  /** Path to the full CI log on disk; only a short tail is kept in state. */
  logTailPath?: string
}

export interface LocalPRAttention {
  reason: string
  since: string
}

export interface LocalPR {
  id: string
  /**
   * Monotonic per-store display number (1, 2, 3…). Shown as `LOCAL-<n>` and
   * echoed by the gh shim as the fake PR URL. The PR-list adapter uses
   * `-localNumber` as the synthetic `PullRequest.number` so it never collides
   * with a real PR number.
   */
  localNumber: number
  projectId: string
  /** Producing session — used for the detail view and fix-on-failure resume. */
  sessionId?: string
  /** Denormalized so the record survives session/pipeline cleanup. */
  worktreePath?: string

  // Foundry-only (optional):
  foundryId?: string
  pipelineId?: string
  /** Creation order within a foundry run == promote order. */
  order?: number
  /** Chained stack: undefined => targets `baseBranch` directly. */
  parentLocalPrId?: string

  // PR content:
  title: string
  body: string
  branch: string
  headSha?: string
  baseBranch: string

  // State + promote results:
  status: LocalPRStatus
  /** Set when the worker ran `gh pr ready` (captured) — promote marks the real PR ready. */
  readyForReview?: boolean
  realPrNumber?: number
  realPrUrl?: string
  ciResult?: LocalPRCIResult
  /** Review-loop findings stored locally (replaces the sticky gh comment). */
  reviewFindings?: string

  createdAt: string
  updatedAt: string
  log: string[]
  attention?: LocalPRAttention
}

export interface CreateLocalPRFromSessionInput {
  projectId: string
  sessionId: string
  worktreePath: string
  branch: string
  baseBranch?: string
  /** Optional overrides; default from the last commit / branch name. */
  title?: string
  body?: string
}

/** Editable fields exposed through LOCAL_PR_UPDATE. */
export interface LocalPRUpdate {
  title?: string
  body?: string
  baseBranch?: string
}

// PR Stacks — a first-class, user-defined chain of dependent PRs. An ordered
// list of entries, each referencing either a local PR (pre-promotion stage) or
// an already-open GitHub PR. The bottom entry targets `baseBranch`; every entry
// above targets the one below it. Foundry runs auto-create one. Managed from the
// right-hand PR Stacks panel: reorder, add/remove, publish (promote the whole
// chain to real PRs), restack-after-merge, and upward propagation (push to a
// lower branch cascades up the chain, with Claude resolving conflicts). ────────

export type PRStackEntryKind = 'local' | 'real'

export interface PRStackEntry {
  /** Stable id within the stack (survives reorder/promotion; used as DnD key). */
  id: string
  kind: PRStackEntryKind
  /** Set when kind==='local' — references LocalPR.id. */
  localPrId?: string
  /** Set when kind==='real' — the GitHub PR number. */
  prNumber?: number
  /** Denormalized for display/ops without a round-trip; refreshed on load. */
  branch?: string
  baseBranch?: string
  /** Position in the chain; 0 = bottom (targets the stack base). */
  order: number
}

/** Resumable cursor for the "Publish" batch — mirrors FoundryRuntimeState.publish. */
export interface PRStackPublishState {
  status: 'idle' | 'running' | 'paused' | 'done' | 'error'
  currentEntryId?: string
  startedAt?: string
  log: string[]
}

export type PRStackPropagationStatus =
  | 'idle'
  | 'running'
  | 'awaiting-conflict'
  | 'paused'
  | 'done'
  | 'error'

/** Resumable cursor for upward propagation (the headline automation). */
export interface PRStackPropagationState {
  status: PRStackPropagationStatus
  /** Entry whose push triggered the cascade (the "source"). */
  sourceEntryId?: string
  /** Entry currently being updated. */
  currentEntryId?: string
  /** Session id of the Claude worker resolving a conflict, if any. */
  conflictSessionId?: string
  startedAt?: string
  log: string[]
}

export interface PRStack {
  id: string
  projectId: string
  name: string
  /** Branch the bottom entry targets (default = repo default branch). */
  baseBranch: string
  /** Link back to the originating run, when foundry-created. */
  foundryId?: string
  entries: PRStackEntry[]
  publish?: PRStackPublishState
  propagation?: PRStackPropagationState
  createdAt: string
  updatedAt: string
}

/** A stack entry with its referenced PR resolved to normalized display fields. */
export interface ResolvedPRStackEntry {
  entry: PRStackEntry
  kind: PRStackEntryKind
  title: string
  branch: string
  baseBranch: string
  /** LocalPRStatus for local entries, or a coarse state for real PRs. */
  status: string
  ciStatus: CIStatus
  prNumber?: number
  prUrl?: string
  /** True once a local entry has been promoted to a real PR. */
  promoted: boolean
}

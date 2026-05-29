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
  | 'costCap'
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

export interface ReviewLoopRound {
  index: number
  startedAt: string
  endedAt?: string
  phase: ReviewLoopPhase
  /** Pro-only: structured issues from review phase. Empty for Lite. */
  rawIssues: ReviewLoopIssue[]
  /** Pro-only: triaged issues. Empty for Lite. */
  triaged: ReviewLoopTriagedIssue[]
  costUsd: number
  log: string[]
  /** Live human-readable lines from each claude subprocess (assistant text, tool calls, errors). */
  transcript: string[]
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
  cumulativeCostUsd: number
  startedAt?: string
  endedAt?: string
  stopReason?: ReviewLoopStopReason
  errorMessage?: string
  /** Pro-only: items the loop chose not to fix; surfaced in sticky PR comment. Empty for Lite. */
  skippedIssues: ReviewLoopTriagedIssue[]
}

export interface ReviewLoopConfig {
  enabled: boolean
  /** Lite (default): unstructured, /review-driven, single shared session for triage→fix. Pro: structured 3-phase pipeline with JSON intermediates and PR comments. */
  variant: ReviewLoopVariant
  maxIterations: number
  consecutiveCleanRounds: number
  costCapUsd: number
}

export interface ReviewLoopProjectOverride {
  enabled?: boolean
  variant?: ReviewLoopVariant
  maxIterations?: number
  consecutiveCleanRounds?: number
  costCapUsd?: number
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
  costCapUsd: 5,
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

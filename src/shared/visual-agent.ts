/**
 * Shared contract for the Visual Agent feature: a GUI chat interface to
 * Claude Code driven over `claude -p --input-format stream-json`.
 *
 * Main process normalises stream-json lines into `VisualAgentEvent`s and
 * pushes `VisualAgentFrame`s to the renderer over `visualAgent:frame`.
 */

export interface VisualAgentModel { id: string; label: string; hint: string }
export const VISUAL_AGENT_MODELS: VisualAgentModel[] = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Most capable — default' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', hint: 'Frontier reasoning' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Fast and capable' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Fastest, cheapest' },
]
export const DEFAULT_VISUAL_AGENT_MODEL = 'claude-opus-5-5'

/**
 * The fixed first message Crucible Code sends into a teleported REPL so Claude
 * Code saves the conversation locally (it writes nothing until the
 * conversation changes). The Agent view matches this exact text and shows the
 * exchange as one collapsed TELEPORT_AUTO_LABEL note.
 */
export const TELEPORT_AUTO_MESSAGE =
  "Teleport to this machine succeeded. This is an automated message from Crucible Code: take no action and reply only with 'Ready.'"
export const TELEPORT_AUTO_LABEL = 'Teleported from the cloud'

export type VisualAgentRunState = 'starting' | 'running' | 'idle' | 'needs-input' | 'done' | 'failed'

interface EventBase {
  uuid: string
  seq: number
  /** 'main' for the top-level conversation, otherwise the parent_tool_use_id of the sub-agent. */
  threadId: string
  at: string
  replayed?: boolean
}

export type VisualAgentEvent = EventBase & (
  | { kind: 'session'; claudeSessionId: string; model: string; cwd: string; tools: string[]; mcpFailed: string[] }
  | { kind: 'text'; role: 'assistant' | 'user'; text: string }
  | { kind: 'note'; source: 'skill' | 'command' | 'command-output' | 'hook' | 'reminder' | 'interrupt' | 'meta'; label: string; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; spawnsThread: boolean }
  | { kind: 'tool-result'; id: string; ok: boolean; text: string }
  | { kind: 'result'; ok: boolean; costUsd: number | null; durationMs: number | null; usage: VisualAgentUsage | null; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'retry'; attempt: number; max: number; delayMs: number; reason: string }
  | { kind: 'compacted'; tokensBefore: number | null; trigger: 'auto' | 'manual' | null }
  | { kind: 'ask'; id: string; tool: string; input: unknown; toolUseId: string; description: string; reason: string; canAlwaysAllow: boolean }
  | { kind: 'ask-result'; id: string; decision: VisualAgentAskDecision }
)

export interface VisualAgentUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

/**
 * A slash command the session's Claude Code offers: built-ins plus the repo's
 * and the user's `.claude/commands`, skills and plugin commands. `name` has no
 * leading slash; `builtin` marks Claude Code's own.
 */
export interface VisualAgentCommand { name: string; description: string; argumentHint: string; builtin: boolean }
export type VisualAgentAskDecision = 'allow' | 'always' | 'deny'

export interface VisualAgentFork {
  id: string
  question: string
  startedAt: string
  afterSeq: number
  state: VisualAgentRunState
  events: VisualAgentEvent[]
}

export interface VisualAgentSnapshot {
  agentId: string
  claudeSessionId: string | null
  model: string
  state: VisualAgentRunState
  events: VisualAgentEvent[]
  partial: { messageId: string; threadId: string; text: string } | null
  usage: { input: number; output: number; total: number } | null
  forks: VisualAgentFork[]
  turnStartedAt: string | null
  /** What the CLI reported it offers; absent until it has said. */
  commands?: VisualAgentCommand[]
}

export type VisualAgentFrame =
  | { t: 'event'; event: VisualAgentEvent }
  | { t: 'partial'; messageId: string; threadId: string; text: string /* accumulated so far */ }
  | { t: 'state'; state: VisualAgentRunState; turnStartedAt: string | null }
  | { t: 'session'; claudeSessionId: string; model: string }
  | { t: 'usage'; usage: { input: number; output: number; total: number } }
  | { t: 'forks'; forks: VisualAgentFork[] }
  | { t: 'fork-event'; forkId: string; event: VisualAgentEvent }
  | { t: 'commands'; commands: VisualAgentCommand[] }
  | { t: 'error'; message: string }

export interface VisualAgentStartOptions {
  agentId: string
  sessionId: string
  cwd: string
  repoPath?: string
  model?: string
  resumeClaudeSessionId?: string | null
  claudeConfigDir?: string | null
  initialPrompt?: string | null
  /**
   * Restart only: when the agent already exists but its process has ended,
   * drop the held conversation and begin a new Claude session instead of
   * resuming the old one.
   */
  fresh?: boolean
}

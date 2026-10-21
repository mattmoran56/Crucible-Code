import { create } from 'zustand'
import type {
  VisualAgentAskDecision,
  VisualAgentEvent,
  VisualAgentFork,
  VisualAgentFrame,
  VisualAgentSnapshot,
  VisualAgentStartOptions,
} from '../../shared/visual-agent'
import { DEFAULT_VISUAL_AGENT_MODEL } from '../../shared/visual-agent'

/**
 * The preload surface this store drives. Declared locally (and read through a
 * guard) so the renderer compiles and degrades gracefully when the bridge is
 * absent — e.g. a Storybook story that seeds the store directly.
 */
export interface VisualAgentApi {
  start(opts: VisualAgentStartOptions): Promise<VisualAgentSnapshot>
  send(agentId: string, text: string): Promise<unknown> | void
  interrupt(agentId: string): Promise<unknown> | void
  stop(agentId: string): Promise<unknown> | void
  answer(
    agentId: string,
    requestId: string,
    decision: VisualAgentAskDecision,
    answers?: Record<string, string>,
  ): Promise<unknown> | void
  setModel(agentId: string, model: string): Promise<unknown> | void
  fork(agentId: string, question: string): Promise<{ forkId: string }>
  forkStop(agentId: string, forkId: string): Promise<unknown> | void
  getState(agentId: string): Promise<VisualAgentSnapshot | null>
  onFrame(cb: (agentId: string, frame: VisualAgentFrame) => void): () => void
}

const api = (): VisualAgentApi | null => {
  if (typeof window === 'undefined') return null
  const held = (window as unknown as { api?: { visualAgent?: VisualAgentApi } }).api
  return held?.visualAgent ?? null
}

/* --- pure reducers --------------------------------------------------------- */

export const LOCAL_UUID = 'local:'

export const emptySnapshot = (agentId: string, model = DEFAULT_VISUAL_AGENT_MODEL): VisualAgentSnapshot => ({
  agentId,
  claudeSessionId: null,
  model,
  state: 'starting',
  events: [],
  partial: null,
  usage: null,
  forks: [],
  turnStartedAt: null,
})

/** The person's own message, drawn the moment it is sent. */
export const localMessage = (text: string, n: number, at = new Date().toISOString()): VisualAgentEvent => ({
  kind: 'text',
  role: 'user',
  text,
  uuid: `${LOCAL_UUID}${n}`,
  seq: -1,
  threadId: 'main',
  at,
})

/**
 * One event appended to a list: duplicates (same uuid) are dropped, and the
 * echo of a message drawn optimistically replaces the local bubble rather than
 * drawing a second one.
 */
export const withEvent = (events: VisualAgentEvent[], event: VisualAgentEvent): VisualAgentEvent[] => {
  if (events.some((held) => held.uuid === event.uuid)) return events
  if (event.kind === 'text' && event.role === 'user') {
    const at = events.findIndex(
      (held) =>
        held.kind === 'text' &&
        held.role === 'user' &&
        held.uuid.startsWith(LOCAL_UUID) &&
        held.text.trim() === event.text.trim(),
    )
    if (at >= 0) {
      const next = events.slice()
      next[at] = event
      return next
    }
  }
  return [...events, event]
}

/** Two lists unioned by uuid, keeping the first list's order then the second's extras. */
export const mergeEvents = (first: VisualAgentEvent[], second: VisualAgentEvent[]): VisualAgentEvent[] => {
  let out = first
  for (const event of second) out = withEvent(out, event)
  return out
}

const mergeForks = (held: VisualAgentFork[], incoming: VisualAgentFork[]): VisualAgentFork[] =>
  incoming.map((fork) => {
    const was = held.find((f) => f.id === fork.id)
    return was ? { ...fork, events: mergeEvents(fork.events ?? [], was.events) } : { ...fork, events: fork.events ?? [] }
  })

const ENDED = new Set(['idle', 'done', 'failed'])

/** One frame folded into a snapshot. Pure; never mutates its input. */
export const reduceFrame = (snap: VisualAgentSnapshot, frame: VisualAgentFrame): VisualAgentSnapshot => {
  switch (frame.t) {
    case 'event': {
      const events = withEvent(snap.events, frame.event)
      const event = frame.event
      // The final assistant text supersedes the streaming partial on its thread.
      const clears =
        snap.partial !== null &&
        event.kind === 'text' &&
        event.role === 'assistant' &&
        event.threadId === snap.partial.threadId
      if (events === snap.events && !clears) return snap
      return { ...snap, events, partial: clears ? null : snap.partial }
    }
    case 'partial':
      // An empty accumulation is the stream saying "nothing in flight".
      if (!frame.text) return snap.partial === null ? snap : { ...snap, partial: null }
      return { ...snap, partial: { messageId: frame.messageId, threadId: frame.threadId, text: frame.text } }
    case 'state':
      return {
        ...snap,
        state: frame.state,
        turnStartedAt: frame.turnStartedAt,
        partial: ENDED.has(frame.state) ? null : snap.partial,
      }
    case 'session':
      return { ...snap, claudeSessionId: frame.claudeSessionId, model: frame.model || snap.model }
    case 'usage':
      return { ...snap, usage: frame.usage }
    case 'forks':
      return { ...snap, forks: mergeForks(snap.forks, frame.forks) }
    case 'fork-event': {
      const at = snap.forks.findIndex((f) => f.id === frame.forkId)
      if (at < 0) return snap
      const fork = snap.forks[at]
      const events = withEvent(fork.events, frame.event)
      if (events === fork.events) return snap
      const forks = snap.forks.slice()
      forks[at] = { ...fork, events }
      return { ...snap, forks }
    }
    case 'error':
      return snap
  }
}

/** A snapshot from `start`/`getState` merged over what frames already delivered. */
export const mergeSnapshot = (held: VisualAgentSnapshot | undefined, incoming: VisualAgentSnapshot): VisualAgentSnapshot => {
  if (!held) return incoming
  return {
    ...incoming,
    events: mergeEvents(incoming.events, held.events),
    forks: mergeForks(held.forks, incoming.forks),
  }
}

/** Whether an ask can still be answered: undecided, on a run that is waiting. */
export const isAskPending = (snap: VisualAgentSnapshot, askId: string): boolean => {
  if (snap.state !== 'needs-input' && snap.state !== 'running') return false
  return !snap.events.some((e) => e.kind === 'ask-result' && e.id === askId)
}

/* --- the store ------------------------------------------------------------- */

interface VisualAgentUi {
  draft: string
  /** The fork whose sheet is open, or null. */
  openForkId: string | null
  /** Breadcrumb of sub-agent thread ids open in the right-hand sheet. */
  subagentPath: string[]
  /** An ask whose answer is in flight. */
  answering: string | null
}

const EMPTY_UI: VisualAgentUi = { draft: '', openForkId: null, subagentPath: [], answering: null }

interface VisualAgentStoreState {
  agents: Record<string, VisualAgentSnapshot>
  errors: Record<string, string | null>
  ui: Record<string, VisualAgentUi>
  options: Record<string, VisualAgentStartOptions>

  ensureStarted: (opts: VisualAgentStartOptions) => Promise<void>
  /** Fold one frame into the matching agent. Exposed for tests and stories. */
  applyFrame: (agentId: string, frame: VisualAgentFrame) => void
  /** Replace an agent's snapshot outright (stories, tests). */
  seed: (snapshot: VisualAgentSnapshot, ui?: Partial<VisualAgentUi>) => void

  send: (agentId: string, text: string) => Promise<void>
  interrupt: (agentId: string) => Promise<void>
  stop: (agentId: string) => Promise<void>
  /** Stop and start again, resuming the same Claude conversation unless `fresh`. */
  restart: (agentId: string, fresh?: boolean) => Promise<void>
  answer: (
    agentId: string,
    requestId: string,
    decision: VisualAgentAskDecision,
    answers?: Record<string, string>,
  ) => Promise<void>
  setModel: (agentId: string, model: string) => Promise<void>
  fork: (agentId: string, question: string) => Promise<string | null>
  forkStop: (agentId: string, forkId: string) => Promise<void>

  setUi: (agentId: string, patch: Partial<VisualAgentUi>) => void
  clearError: (agentId: string) => void
}

let localCount = 0
let unsubscribe: (() => void) | null = null
const inFlight = new Map<string, Promise<void>>()
/** Agents this renderer has fetched a snapshot for (frames alone don't count). */
const started = new Set<string>()

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const useVisualAgentStore = create<VisualAgentStoreState>((set, get) => {
  const subscribe = (): void => {
    if (unsubscribe) return
    const bridge = api()
    if (!bridge) return
    unsubscribe = bridge.onFrame((agentId, frame) => get().applyFrame(agentId, frame))
  }

  const patchSnap = (agentId: string, fn: (snap: VisualAgentSnapshot) => VisualAgentSnapshot): void =>
    set((s) => {
      const held = s.agents[agentId] ?? emptySnapshot(agentId)
      const next = fn(held)
      return next === held ? s : { agents: { ...s.agents, [agentId]: next } }
    })

  const fail = (agentId: string, error: unknown): void =>
    set((s) => ({ errors: { ...s.errors, [agentId]: errorText(error) } }))

  const startFresh = async (opts: VisualAgentStartOptions): Promise<void> => {
    const bridge = api()
    if (!bridge) {
      fail(opts.agentId, 'The Visual Agent bridge is not available')
      return
    }
    subscribe()
    try {
      const existing = await bridge.getState(opts.agentId)
      const snap = existing ?? (await bridge.start(opts))
      started.add(opts.agentId)
      set((s) => ({ agents: { ...s.agents, [opts.agentId]: mergeSnapshot(s.agents[opts.agentId], snap) } }))
    } catch (error) {
      fail(opts.agentId, error)
      patchSnap(opts.agentId, (snap) => ({ ...snap, state: 'failed' }))
    }
  }

  return {
    agents: {},
    errors: {},
    ui: {},
    options: {},

    ensureStarted: async (opts) => {
      set((s) => ({ options: { ...s.options, [opts.agentId]: opts } }))
      subscribe()
      if (started.has(opts.agentId)) return
      const pending = inFlight.get(opts.agentId)
      if (pending) return pending
      const run = startFresh(opts).finally(() => inFlight.delete(opts.agentId))
      inFlight.set(opts.agentId, run)
      return run
    },

    applyFrame: (agentId, frame) => {
      if (frame.t === 'error') {
        set((s) => ({ errors: { ...s.errors, [agentId]: frame.message } }))
        return
      }
      patchSnap(agentId, (snap) => reduceFrame(snap, frame))
      // An answer is settled once its ask-result arrives.
      if (frame.t === 'event' && frame.event.kind === 'ask-result') {
        const ui = get().ui[agentId]
        if (ui?.answering === frame.event.id) get().setUi(agentId, { answering: null })
      }
    },

    seed: (snapshot, ui) => {
      started.add(snapshot.agentId)
      set((s) => ({
        agents: { ...s.agents, [snapshot.agentId]: snapshot },
        ui: { ...s.ui, [snapshot.agentId]: { ...EMPTY_UI, ...s.ui[snapshot.agentId], ...ui } },
      }))
    },

    send: async (agentId, text) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const local = localMessage(text, ++localCount)
      patchSnap(agentId, (snap) => ({ ...snap, events: [...snap.events, local] }))
      try {
        await api()?.send(agentId, text)
      } catch (error) {
        fail(agentId, error)
      }
    },

    interrupt: async (agentId) => {
      try {
        await api()?.interrupt(agentId)
      } catch (error) {
        fail(agentId, error)
      }
    },

    stop: async (agentId) => {
      try {
        await api()?.stop(agentId)
      } catch (error) {
        fail(agentId, error)
      }
    },

    restart: async (agentId, fresh = false) => {
      const opts = get().options[agentId]
      const snap = get().agents[agentId]
      if (!opts) return
      try {
        await api()?.stop(agentId)
      } catch {
        /* already gone */
      }
      started.delete(agentId)
      set((s) => {
        const agents = { ...s.agents }
        delete agents[agentId]
        return { agents, errors: { ...s.errors, [agentId]: null } }
      })
      const resume = fresh ? null : (snap?.claudeSessionId ?? opts.resumeClaudeSessionId ?? null)
      await startFresh({
        ...opts,
        model: snap?.model ?? opts.model,
        resumeClaudeSessionId: resume,
        initialPrompt: null,
      })
    },

    answer: async (agentId, requestId, decision, answers) => {
      get().setUi(agentId, { answering: requestId })
      try {
        await api()?.answer(agentId, requestId, decision, answers)
      } catch (error) {
        get().setUi(agentId, { answering: null })
        fail(agentId, error)
      }
    },

    setModel: async (agentId, model) => {
      patchSnap(agentId, (snap) => ({ ...snap, model }))
      try {
        await api()?.setModel(agentId, model)
      } catch (error) {
        fail(agentId, error)
      }
    },

    fork: async (agentId, question) => {
      const bridge = api()
      if (!bridge || !question.trim()) return null
      try {
        const { forkId } = await bridge.fork(agentId, question.trim())
        get().setUi(agentId, { openForkId: forkId })
        return forkId
      } catch (error) {
        fail(agentId, error)
        return null
      }
    },

    forkStop: async (agentId, forkId) => {
      try {
        await api()?.forkStop(agentId, forkId)
      } catch (error) {
        fail(agentId, error)
      }
    },

    setUi: (agentId, patch) =>
      set((s) => ({ ui: { ...s.ui, [agentId]: { ...EMPTY_UI, ...s.ui[agentId], ...patch } } })),

    clearError: (agentId) => set((s) => ({ errors: { ...s.errors, [agentId]: null } })),
  }
})

export const visualAgentUi = (agentId: string): VisualAgentUi =>
  useVisualAgentStore.getState().ui[agentId] ?? EMPTY_UI

export { EMPTY_UI as EMPTY_VISUAL_AGENT_UI }
export type { VisualAgentUi }

/** Test-only: drop the frame subscription so a fresh `window.api` is picked up. */
export const __resetVisualAgentSubscription = (): void => {
  unsubscribe?.()
  unsubscribe = null
  inFlight.clear()
  started.clear()
}

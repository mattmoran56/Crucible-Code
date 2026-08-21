# Overseer — a master agent over every session

> One agent that watches every session in every project, tells you what's going on, unblocks what it safely can, and escalates the rest to you in a chat panel.

**Status: plan / not yet implemented.** This document is the design and delivery plan. Naming (`Overseer`) is a placeholder — swap it before Phase 0 if you prefer `Chief`, `Bridge`, or `Lead`.

## The idea

Every session in Crucible is already a developer working away in its own worktree. What's missing is a manager. Today *you* are the manager: you scan sidebar dots, click into sessions, work out which of the seven yellow badges actually matters, and answer the same "which approach do you want?" question in four different tabs.

The Overseer is that manager. It sees the whole fleet, ranks what needs you, drafts the answers to the easy questions, and hands you a single chat thread instead of N terminals.

## Decisions taken

These were settled up-front; the rest of the document follows from them.

| Question | Decision |
|---|---|
| Where it runs | Headless `claude -p` inside the Electron main process, foreman-style. Runs on your Claude subscription (`-p` pot), not API billing. |
| Hierarchy | **One master**, project-scoped views. No per-project leader agents in v1. |
| Reading a session | Claude Code's own JSONL transcripts **plus** an ANSI-stripped tail of the live PTY. |
| Waking up | Hook events (debounced) **plus** a periodic safety-net sweep. |
| Autonomy | May answer content questions and control session lifecycle — but *every* session-affecting action is a **proposal you approve in chat**. |
| Escalation surface | In-app chat panel. (Built main-process-first so the remote receiver can pick it up later for free.) |
| Proactive output | Live attention queue, scheduled standup digest, per-session close-out summaries. |

### The one tension worth naming

"May answer content questions" and "propose, then you approve" pull against each other — if you approve every reply, the leader isn't unblocking anything, you are. That's deliberate for v1: the *mechanism* (a typed, validated, audited action) is the hard part, and shipping it behind a one-tap approval is how we earn trust in it. Phase 5 adds an auto-approve allowlist (`project X, kind=reply, auto`) which flips the same machinery to hands-off without redesigning anything. Approve-first is a launch posture, not the end state.

## Mental model — two brains, one wallet

Deliberately the same split that makes Foundry reliable ([docs/FOUNDRY.md](FOUNDRY.md)):

- **Overseer pass** — a headless Claude run. Reads a fleet snapshot, can drill into any session through MCP tools, and emits a decision document: a chat reply, a ranked attention queue, and zero or more *proposals*. **It never touches a session directly.**
- **Overseer service** — plain TypeScript in main. Builds the snapshot, validates the decision, stores proposals, enforces the hard safety rules, and executes only what you approved. **It never makes judgement calls.**

The LLM can suggest anything — reply to a session that doesn't exist, answer a question that's already moved on, type at a permission prompt. The service drops all of it.

```
  hook event (notification|stop)          safety-net sweep (N min)
  chat message from you                   manual "Run now"
            │                                       │
            └──────────── debounce 5s ──────────────┘
                              │
                              ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  SNAPSHOT (overseer.service)                                 │
  │    per session: status · signals · last turns · git · PR     │
  │    deterministic — no LLM                                    │
  └──────────────────────────────┬───────────────────────────────┘
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  PASS  (claude -p, resumed session)                          │
  │    reads snapshot; MCP tools to drill deeper on demand       │
  │    writes decision.json:                                     │
  │      { chatReply, queue[], proposals[], digest? }            │
  └──────────────────────────────┬───────────────────────────────┘
                                 ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  VALIDATE + STORE (overseer.service)                         │
  │    unknown sessionId? drop.  permission prompt on screen?    │
  │    drop.  session moved on since snapshot? mark stale.       │
  └──────────────────────────────┬───────────────────────────────┘
                                 ▼
              chat panel: reply + queue + [Approve] [Reject]
                                 │
                       you approve ──▶ EXECUTE (typed inject / lifecycle)
                                        └─▶ audit entry + marker in session log
```

## What already exists (and what doesn't)

Most of the plumbing is in the repo. The honest gaps are small and specific.

**Already there:**

| Need | Where |
|---|---|
| Headless Claude runner with cost capture + resume | `claude-headless.service.ts` (`runHeadlessClaude`) |
| Event-driven pass loop, decision validation, cost cap | `foundry-foreman.service.ts` — the pattern to copy |
| Hook events (`prompt`/`notification`/`stop`) per context+tab | `notification-server.ts` (`onHookEvent`) |
| Read a live terminal | `terminal.service.ts` (`getTerminalBuffer`) |
| Safely type into a live Claude TUI | `foundry.service.ts` (`injectAndAwaitResponse` — bracketed paste, delay, CR, stale-stop rejection) |
| Lifecycle control | `killTerminal`, `killSessionTerminals`, `spawnTerminal` |
| Per-session cost / rate limits | `usage.service.ts` (statusLine → temp file) |
| Git / PR / review-loop / foundry state | existing services, all reachable via `invokeHandler` |
| Scheduling | `scheduler.service.ts` |
| Remote surface for free later | `remote/server/bridge.ts` fans every IPC handler + event over WS |

**Genuinely missing:**

1. **Session status lives in the renderer.** `notificationStore` derives `attention`/`completed`/`running` from hook events client-side. A main-process agent has no idea which sessions are waiting. Must move.
2. **Nothing reads Claude Code transcripts.** No JSONL reader anywhere in the repo.
3. **No prompt-state classifier.** Nothing can currently tell "Claude is asking a design question" from "Claude is asking permission to run `rm -rf`". This distinction is the entire safety story.
4. **No stall detection.** Hooks fire when an agent *asks*. Nothing fires when a session quietly burns an hour re-running a doomed test.
5. **No chat surface.** No chat component or store exists.

## Hard safety rules

Enforced in TypeScript, not in the prompt. A prompt instruction is a suggestion; these are invariants.

1. **Never type at a permission prompt.** If the screen classifier says the session is showing a tool-permission prompt, every `reply` proposal for that session is dropped at validation time and re-raised as an `escalate`. This is the `CLAUDE.md` "never bypass permissions" rule holding at the manager layer — a leader tapping `2. Yes, and don't ask again` on your behalf is bypass-by-proxy.
2. **No direct write path.** The pass has no tool that types into a session. It can only emit proposals. Execution is a separate, user-triggered code path.
3. **Staleness guard.** A `reply` proposal records the transcript cursor + screen hash it was drafted against. If the session has advanced since, the proposal is marked `stale` and cannot be approved — you're never approving an answer to a question that's already gone.
4. **Scope gate.** Sessions are only managed if their project is opted in (`overseerManaged`), with a per-session override. Default off.
5. **Rate limits.** Max N executed proposals per hour; never two replies into the same session without an intervening turn from that session.
6. **Audit.** Every execution appends a visible marker into the session's chat (`[Overseer] …`) and an entry in the Overseer history. You can always answer "who typed that?"

## Components to build

### `session-status.service.ts` (main) — prerequisite

Move status derivation out of the renderer. Extract the existing reducer from `notificationStore` into `src/shared/sessionStatus.ts` as a pure function, then:

- main subscribes to `onHookEvent`, keeps authoritative per-`(contextId, tabId)` state and the rolled-up per-context status (`attention > completed > running`);
- renderer store becomes a mirror driven by an IPC event, using the *same* shared reducer, so the two can't drift;
- the remote receiver gets correct sidebar status as a side effect (it currently can't compute this at all).

### `session-transcript.service.ts` (main)

Reads what a session actually did.

- **Path resolution:** the hook POST body already reaches us in `notification-server.ts` and is already `JSON.parse`d — we just throw it away except for `cwd`. Claude Code's payload carries `session_id` and `transcript_path`. Capture and store them per `(contextId, tabId)`. That's an exact, non-guessy mapping, and it's a ~10-line change.
  - *Fallback* for sessions that haven't fired a hook yet: newest `*.jsonl` under `<CLAUDE_CONFIG_DIR|~/.claude>/projects/<slug(worktreePath)>`. Note the config dir is per-account (`Project.claudeAccountId` → `ClaudeAccount.configDir`), already resolved in `terminal.service.ts`.
- **Parse:** tail the JSONL for the last N turns — role, text, tool names + short args, timestamps, token usage. Feed usage into a real "how far through the context window" number (the thing you actually meant by "how much of the session").
- **Screen tail:** last ~2KB of `getTerminalBuffer`, ANSI-stripped, for what's on screen *right now*.

### `session-signals.ts` (shared, pure)

Cheap deterministic flags computed before any LLM sees anything. They stop the pass from having to infer state from raw bytes, and they're independently testable:

- `waiting-question` / `waiting-permission` (from the classifier)
- `idle` — no PTY output for > X minutes while status is `running`
- `looping` — same tool + same arg repeated ≥ N times in the tail
- `context-pressure` — context window > 85%
- `usage-limit` — the real "usage limit reached" banner (reuse the existing detector from the auto-continue feature, don't write a second one)
- `pr-red` / `pr-conflict` — from existing PR state
- `long-running` — session open > X hours with no commit

### `prompt-state.ts` (shared, pure)

Classifies the screen tail into `permission-prompt | question | input-idle | working | unknown`. Pattern-matches Claude Code's TUI shapes (numbered allow/deny options vs a bare input box). Pure function, heavily unit-tested, and **fails closed**: `unknown` is treated as `permission-prompt` for gating purposes.

### `overseer.service.ts` (main)

The deterministic half.

- Builds the snapshot: projects → sessions → `{ status, signals, lastTurns, contextPct, costUsd, git: {branch, ahead, dirty}, pr: {number, ciStatus, reviewState} }`.
- Owns the trigger loop: hook events (debounced 5s), safety-net interval, manual, chat.
- **Skips no-op passes**: hash the snapshot; if unchanged since the last pass and the trigger is the safety-net, skip. Free money.
- Validates decisions (mirror `validateDecision` in `foundry-foreman.service.ts`: drop unknown ids, enforce caps, dedupe by content hash).
- Stores proposals + chat thread in an `electron-store` named `overseer`.
- Executes approved proposals. `reply`/`nudge` go through a shared `injectPrompt` helper **extracted from** `foundry.service.ts#injectAndAwaitResponse` — do not write a second PTY injection path; that function already handles bracketed paste, the render delay, and stale-stop rejection.

### `overseer-pass.service.ts` (main)

The LLM half. Wraps `runHeadlessClaude` with:

- the snapshot written to `context.json` in a scratch dir;
- an output contract: write `decision.json` with `{ chatReply, queue[], proposals[], digest? }`;
- `--mcp-config` pointing at the Overseer MCP shim (below) for drill-down;
- `resumeId` for continuity across passes and chat turns, with an automatic fresh start when the transcript exceeds a threshold, seeded by a carry-over summary (the same trick `review-loop-efficient.service.ts` uses for its persistent worker);
- a daily `overseerCostCapUsd`, mirroring `foremanCostCapUsd`.

Model split: cheap model for sweeps, your normal model for chat turns. Two settings, sensible defaults.

### `overseer-mcp` shim

The snapshot can't hold everything — when you ask "what's session X actually doing?", the agent needs to fetch, not guess. So the pass gets tools:

- `list_sessions(projectId?)`, `get_session(sessionId)`, `read_transcript(sessionId, turns)`, `read_screen(sessionId)`, `get_diff(sessionId)`, `get_pr(sessionId)`, `propose(action)`.

Implementation: a tiny stdio MCP server spawned by `claude -p` that proxies to a loopback HTTP endpoint in main, which maps tool → `invokeHandler(channel, args)`. That reuses the exact bridge the remote receiver already uses, so there's one API surface, not two.

**Security:** that endpoint exposes IPC to anything that can reach it. Bind `127.0.0.1`, require a per-pass bearer token passed via env, expire it when the pass ends. Same posture as `notification-server.ts`, one notch stricter.

### Chat panel (renderer)

New workspace panel. Thread of typed items — `user`, `assistant`, `proposal`, `digest`, `queue-update` — with proposals rendered as cards: rationale, the exact text that will be typed, target session, `[Approve] [Reject] [Open session]`, and a `stale` state that disables approval.

All state lives in main and arrives over IPC events (the review-loop panel is the model to copy). Keep zero chat state renderer-only — that's what makes the mobile receiver a small follow-up instead of a rewrite.

The **attention queue** renders from deterministic signals when no pass has run, and gets re-ranked with one-line "why"s after a pass. It's never blank and never stale.

## Delivery phases

Each phase is independently shippable and independently useful.

**Phase 0 — foundations, no LLM.**
`session-status.service.ts` + shared reducer, `session-transcript.service.ts`, `prompt-state.ts`, `session-signals.ts`. Ship a deterministic **Attention queue** panel: every session across every project, ranked by signals, with a real context-usage number. *Useful on day one with zero token spend, and it de-risks everything after it.* Heavy unit tests here — this is where correctness is cheap.

**Phase 1 — read-only Overseer.** `overseer.service` + `overseer-pass.service` + MCP shim + chat panel. You can ask "what's going on?", "what's blocked?", "what is the auth session doing?" and get real answers. No writes exist yet in the codebase, so nothing can go wrong in a session.

**Phase 2 — proposals.** `reply` and `nudge` kinds, the staleness guard, the permission-prompt gate, execution via the extracted `injectPrompt`, audit markers, scope gating. This is the phase to be slow and paranoid in.

**Phase 3 — lifecycle + sweeps.** `restart` / `kill` proposals, the safety-net interval, stall-signal tuning against real sessions.

**Phase 4 — proactive output.** Scheduled standup digest (reuse `scheduler.service`), per-session close-out summaries on `stop`+PR, Settings page (managed projects, cost caps, models, digest time), desktop notification on escalation.

**Phase 5 — deferred, in rough priority order.** Auto-approve allowlist per project+kind (turns the manager hands-off); mobile via the remote receiver; per-project leader agents; git/PR actions.

## Cost

Worth being honest: a pass on every hook event across a busy fleet is the failure mode. Mitigations, in order of impact: snapshot hashing to skip no-op sweeps, 5s debounce, cheap model for sweeps, deterministic signals doing the pre-filtering so the prompt is small, a daily USD cap that hard-stops passes, and a "manual only" mode. Instrument cost per pass from day one — `runHeadlessClaude` already returns `costUsd`.

## Risks

| Risk | Mitigation |
|---|---|
| Typing into a PTY is racy | Reuse `injectAndAwaitResponse`, never hand-roll. Verify with the existing PTY-growth check. |
| Answering a question that already moved on | Staleness guard (transcript cursor + screen hash). |
| Approving a permission prompt by accident | Classifier fails closed; `reply` into a permission prompt is unrepresentable at the service layer. |
| Master's own context grows unboundedly | Resume-chain cap + carry-over summary restart. |
| Renderer/main status divergence | One shared pure reducer, main authoritative. |
| MCP endpoint = local IPC hole | Loopback bind + per-pass expiring token. |
| Reading transcripts surfaces secrets to the pass | Same machine, same trust boundary as the session itself — but note it, and keep transcript slices out of any digest that leaves the machine. |

## Testing & docs

- Vitest units: status reducer, prompt-state classifier, JSONL parser, signals, decision validator, staleness guard. All pure functions — no Electron needed.
- Storybook stories for panel states (empty, queue-only, proposal pending, proposal stale, digest).
- Per `CLAUDE.md`: front-end PRs need screenshots with absolute raw URLs; README gets a feature bullet and a `<details>` section as the panel lands.

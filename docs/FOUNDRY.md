# Foundry

> Run a whole Notion task set on autopilot. A foreman plans dependencies, multiple workers run in parallel, and the human only reviews code and tests.

Foundry is the next layer above the [single-ticket Notion integration](../README.md#notion-task-integration). Where the Notion poller turns one Notion row into one Claude session, the **Foundry** turns an *entire backlog* into a planned, dependency-aware stream of work — sessions, draft PRs, review loops, finalisation, all coordinated.

You do code review and write tests. Foundry does everything else.

## Mental model — two brains, one wallet

Foundry has two distinct decision-makers operating against the same budget:

- **Foreman** — a real Claude session you can watch and nudge. Reads the entire task set + your codebase, infers dependencies between tickets, decides *which tickets to start next and in what order*. Writes its decision to a JSON file. **Doesn't write code.**

- **Pipeline FSM** — pure TypeScript in the main process. Watches for the foreman's decision file, validates it, executes it deterministically. Spawns the worker session, watches for the draft PR, kicks off the review loop, runs your finalize prompt, marks the PR ready. **Doesn't make decisions.**

That separation is the whole reason it stays reliable. The LLM can suggest anything (start 50 tasks! pick a non-existent ticket! re-document the same plan eight times!) but the FSM enforces concurrency, validates pageIds, dedupes notes by content hash, and ignores anything malformed.

```
┌─────────────────────────────────────────────────────────────────────┐
│  WATCHER (foundry.service, every 20s)                               │
│                                                                     │
│  Notion query (task-set filter) → pages + their statuses            │
│            │                                                        │
│            ▼                                                        │
│       pageStatusSnapshot ──diff──▶ status moves                     │
│                                       │                             │
│      ┌───────────┬──────────┬─────────┴────────┐                    │
│      ▼           ▼          ▼                  ▼                    │
│   transition  slot freed  manual         enabled / safety net       │
│      └───────────┴──────────┴───────── debounce 5s ─────────────┐   │
│                                                                 │   │
└─────────────────────────────────────────────────────────────────┼───┘
                                                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FOREMAN PASS (foundry-foreman.service)                             │
│                                                                     │
│  1. Build context.json:                                             │
│        { freeSlots, runningPipelines, completedStatuses,            │
│          completionTransition, tasks:[{ pageId, title, status,      │
│                                        body…(6KB cap) }] }          │
│                                                                     │
│  2. Spawn a real, interactive `claude` PTY in the project repo      │
│     - prompt piped via heredoc as first input                       │
│     - the user can type into it to nudge mid-pass                   │
│     - file watcher on the pass dir for decision.json                │
│                                                                     │
│  3. Foreman writes decision.json:                                   │
│        { start:[{ pageId, reason, branchName, sessionName }],       │
│          blocked:[{ pageId, reason }],                              │
│          ticketNotes:[{ pageId, comment, dependsOn? }],             │
│          summary }                                                  │
│                                                                     │
│  4. FSM validates (deterministic):                                  │
│        - drop unknown / already-running pageIds                     │
│        - cap at freeSlots                                           │
│        - sanitize branch (feat/<slug>, fix/<slug>, etc.)            │
│        - dedup notes by sha1 hash                                   │
│                                                                     │
│  5. FSM applies:                                                    │
│        - append plan notes to each ticket (best-effort)             │
│        - startPipeline() per validated start entry                  │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PIPELINE FSM — one per task                                        │
│                                                                     │
│   spawn-requested                                                   │
│        │  • ensure base branch exists (auto-create + push if not)   │
│        │  • apply Notion pickup updates ("Not Started → In Prog")   │
│        │  • emit FOUNDRY_FIRE_TASK to renderer                      │
│        ▼                                                            │
│   ┌───── renderer materializes ─────┐                               │
│   │  • create worktree off baseBranch│                              │
│   │  • new Session row + register   │                               │
│   │  • spawn claude PTY with        │                               │
│   │    implement prompt             │                               │
│   │  • ack FOUNDRY_TASK_STARTED     │                               │
│   └─────────────────────────────────┘                               │
│        ▼                                                            │
│   implementing                                                      │
│        │  poll `gh pr list --head <branch>` every 15s              │
│        │  also opportunistically check on each Stop hook event      │
│        │                                                            │
│        │  • timeout (60m default) → attention                       │
│        │  • draft PR appears → advance                              │
│        ▼                                                            │
│   reviewing                                                         │
│        │  startReviewLoopLite — listens on eventBus for             │
│        │  REVIEW_LOOP_STATE_UPDATE                                  │
│        │                                                            │
│        │  • converged → finalize                                    │
│        │  • non-converged → attention (configurable: proceed)       │
│        ▼                                                            │
│   finalizing                                                        │
│        │  if readyForReviewCommandTemplate set:                     │
│        │    inject prompt into worker's PTY (bracketed paste),      │
│        │    wait for stop event + verified buffer growth,           │
│        │    verifyPRReady (read gh; don't mark ourselves)           │
│        │  else markPRReady ourselves                                │
│        │  apply Notion readyForReviewUpdates                        │
│        ▼                                                            │
│   done                                                              │
│        │                                                            │
│        └─→ requestPass('slot-freed')  ↺  back to foreman            │
└─────────────────────────────────────────────────────────────────────┘
```

## What triggers a foreman pass

Layered, so there's always a fast path **and** a backstop:

| Trigger | When | Latency |
|---|---|---|
| Snapshot diff | A ticket status moves (the configured `from → to` transition, or anything entering a "completed" status) | 20s watcher tick + 5s debounce |
| Slot freed | A pipeline reaches `done` / `cancelled` / `orphaned` | immediate (5s debounce) |
| Manual "Run pass" | Foundry panel button | immediate |
| Off→on toggle | User flips the foundry enabled | 2.5s renderer-ready buffer + 5s debounce |
| App startup | If the foundry is already on at launch | 2.5s + 5s |
| Safety-net cron | every 10 minutes regardless | 10m |

Snapshot-diff detection is actor-agnostic — it doesn't matter whether a human, a Notion automation, a Linear sync, or a webhook moved the ticket. We just notice that the value changed and fire.

## What the foreman sees

The pass prompt instructs the foreman to read `context.json` only. That file is everything the foreman knows:

```jsonc
{
  "foundry": { "id": "...", "name": "Simulation attempt tracking" },
  "freeSlots": 2,
  "completionTransition": { "property": "Status", "fromValue": "In review", "toValue": "Testing" },
  "completedStatuses": ["Done", "Testing"],
  "runningPipelines": [
    { "pageId": "p1", "phase": "reviewing", "branch": "feat/attempts-table" }
  ],
  "tasks": [
    {
      "pageId": "p2",
      "title": "[T2.1] POST /jobdrops/:id/attempt (idempotent open)",
      "url": "https://app.notion.com/p/...",
      "status": "Not Started",
      "body": "## Phase 2 · Write Path\nSurface: Go · webApi · Estimate: ~0.5d\n## Why this is the unit\n..." // ~6KB cap
    }
  ]
}
```

The body of each ticket is fetched fresh from Notion every pass (capped at ~6KB per ticket) so the foreman gets the canonical task description — not just the title.

## What the foreman writes

```jsonc
{
  "planMarkdown": "Phase 1 is the schema layer (T1.1 + T1.2 + T1.3) — independent additive migrations, all unblocking Phase 2 write-path work...",
  "ticketNotes": [
    {
      "pageId": "p5",
      "comment": "**Foundry plan** — T2.1 depends on T1.4 (model + repo). Waiting for Phase 1.",
      "dependsOn": ["p2", "p3"]
    }
  ],
  "start": [
    {
      "pageId": "p2",
      "reason": "no deps, additive schema migration, critical-path root",
      "branchName": "feat/attempts-table",
      "sessionName": "attempts-table"
    },
    {
      "pageId": "p3",
      "reason": "sibling of p2 on a different table, runs cleanly in parallel",
      "branchName": "feat/attempt-id-column",
      "sessionName": "attempt-id-column"
    }
  ],
  "blocked": [
    { "pageId": "p5", "reason": "T2.1 depends on T1.4 — still In Progress" }
  ],
  "summary": "started 2 (Phase 1 critical path), 1 blocked"
}
```

The foreman picks **conventional branch names** — `feat/<slug>`, `fix/<slug>`, `refactor/<slug>`, `chore/<slug>`, `docs/<slug>`, `test/<slug>`, `perf/<slug>`, `style/<slug>` — short kebab-case slugs that read like human-named branches, **not** mechanically slugified ticket titles.

## Validation (the deterministic safety boundary)

Every field in `decision.json` is filtered before execution:

- **`start[]` page ids** must be in `context.tasks`. Unknown → dropped with warning.
- **`start[]` page ids** must not already be in `runningPipelines`. Duplicate → dropped with warning.
- **`start[].length`** is hard-capped at `freeSlots`. Overflow → dropped with warning.
- **`branchName`** must match `^(feat|fix|refactor|chore|docs|test|perf|style)/[a-z0-9-]+$`. Invalid → dropped (falls back to `branchNameTemplate`).
- **`sessionName`** defaults to the slug part of `branchName` if missing; sanitised to `[a-z0-9-]` only.
- **`ticketNotes[]`** are hashed by `sha1(pageId + comment)`. If the hash matches `documentedHashes[pageId]` (i.e. we already posted this exact note), drop it with warning. Prevents the same plan re-appearing as a new comment every pass.
- **`ticketNotes[].dependsOn`** are filtered to only known page ids.

The LLM's authority over real-world side effects is exactly **zero**. It writes a file; the FSM decides what's executable.

## Pipeline phases in detail

### `spawn-requested`

The foundry has decided to start this task. Before firing the worker spawn:

1. **`ensureBaseBranchExists`** — if `cfg.baseBranch` is set (e.g. `project/simulation-attempt-tracking`), the foundry checks origin first. If it doesn't exist anywhere, the foundry creates it off the repo default (`origin/main` / `origin/staging` / etc.) and pushes. So workers can always branch off the configured base, even if you've named one that doesn't exist yet.
2. **Pickup updates** — applies immediate `pickupUpdates` to the Notion ticket (e.g. `Status: Not Started → In Progress`). Updates whose template references `{{branch}}` / `{{sessionId}}` are deferred to step 5.
3. **Cross-feature claim** — calls `addPickedUp` on the classic Notion poller so the same row can't get double-fired by both systems on a shared DB.
4. **Pipeline row created** — visible in the Foundry panel.
5. **`FOUNDRY_FIRE_TASK` emitted** to the renderer. The renderer creates the worktree, the session row, registers the notification context (one-line fix the foundry bootstrap applies — see `useFoundryBootstrap.ts`), and spawns a `claude` PTY with the implement prompt piped via heredoc.
6. **Renderer acks** with `FOUNDRY_TASK_STARTED { sessionId, branch, worktreePath }`. Now we know the session is alive.
7. **Deferred pickup updates** apply (the ones that needed `{{branch}}` / `{{sessionId}}`).

If the ack times out (30s), the foundry re-fires up to 3 times before parking the pipeline with attention `worker-spawn ack never arrived`.

### `implementing`

Two parallel signals:

- **PR polling**: every 15s, `gh pr list --head <branch> --state open --json number,url,isDraft`. As soon as a draft PR exists for the branch, advance.
- **Stop hook hint**: when claude in the worker's PTY emits a Stop hook (i.e. finished a turn), we opportunistically check the PR right away rather than waiting for the next 15s tick.

If no PR appears within the implement timeout (default 60m), the pipeline parks with attention. The poll keeps running — if the worker eventually opens the PR, we still advance.

The worker is responsible for committing, pushing, and opening the draft PR itself. The implement prompt explicitly tells it so — see your **Settings → Foundry → Implement prompt** for exactly what the worker is told.

### `reviewing`

We call `startReviewLoopLite` against the worker's session. The review loop is the existing [Lite Review Loop](../README.md#review-loop), pointed at the freshly-opened draft PR. The foundry subscribes to `REVIEW_LOOP_STATE_UPDATE` on the in-process event bus — when the loop transitions out of `running`, we react:

- `completed` → advance to `finalizing`.
- `error` / `maxIterations` / `costCap` / `cancelled` → behaviour depends on `onReviewNonConvergence`:
  - `attention` (default) → park the pipeline; human picks it up via the panel's Retry / Skip-to-finalize buttons.
  - `proceed` → finalize anyway.

### `finalizing`

Optional `readyForReviewCommandTemplate` injection:

1. Find the worker's existing agent terminal via `listTerminalsForSession`.
2. **Wrap the prompt in bracketed-paste escape sequences** (`\x1b[200~ ... \x1b[201~`) so claude's TUI treats the whole multi-line block as one paste, not a sequence of keystrokes.
3. Wait 250ms for the TUI to render.
4. Send `\r` as a separate write to submit.
5. **Snapshot the PTY's rolling buffer length** before writing. After the next Stop hook event, require the buffer to have grown by ≥200 bytes. Anything smaller is treated as a stale stop event (e.g. the synthetic stop fired by the PTY's auto-restart) and we keep waiting.
6. After verified completion, **`verifyPRReady`** — re-fetch the PR from `gh`, check `isDraft === false`. If your prompt didn't mark it ready, the pipeline parks with attention `your prompt didn't mark it ready`. The foundry **does not override** your prompt.

If `readyForReviewCommandTemplate` is empty, the foundry falls back to its own `markPRReady` call so default autopilot still works.

After the PR is verified ready: apply Notion `readyForReviewUpdates` (e.g. move the ticket to "In review"). The pipeline advances to `done`, slot frees, foreman pass fires.

### `done` / `cancelled` / `orphaned`

Terminal phases. The pipeline stays in the panel's "Completed" section for visibility but no longer consumes a slot.

- `done` — normal completion.
- `cancelled` — user clicked Cancel in the panel.
- `orphaned` — the worktree disappeared mid-pipeline. Sessions stay intact for salvage; foundry stops tracking.

## Failure modes & attention

The pipeline parks with `attention { reason, since }` when:

| Reason | Trigger |
|---|---|
| `worker-spawn ack never arrived` | Renderer never acked after 3 re-fires |
| `no PR after Nm — worker may be stuck` | Implement timeout exceeded with no PR |
| `worker session terminal is gone — cannot inject ready-for-review command` | The worker session was killed before finalize |
| `ready-for-review command never produced a worker response` | Injected prompt never made the PTY buffer grow meaningfully (likely a stale stop event or auto-restart race) |
| `ready-for-review prompt finished but PR #N is still a draft — your prompt didn't mark it ready` | `verifyPRReady` returned false |
| `review-loop start failed: ...` | `startReviewLoopLite` threw |
| `review-loop <status> (<stopReason>)` | Review loop ended non-converged with `onReviewNonConvergence: attention` |
| `base branch "<base>" could not be ensured: ...` | `ensureBaseBranchExists` couldn't reach the remote or push |

A flagged pipeline still **occupies a slot** — the foundry won't pile on while a human is rescuing it. Cancel frees the slot.

The panel offers per-pipeline actions: Resume (clears attention, retries the current phase), Retry phase (re-runs without clearing attention first), Skip phase (jumps to finalize, useful when review-loop wedged), Cancel.

## State that's persisted

`~/Library/Application Support/codecrucible/dev/foundry-state.json` (or the equivalent under the packaged app's `userData`):

- `pageStatusSnapshot` — per-page status at the last tick. Preserved across restarts so an offline transition fires exactly once on next startup.
- `documentedHashes` — sha1 per ticket note. Prevents re-documenting the same plan.
- `pipelines[]` — full pipeline FSM state. Rehydrated on app start (spawn-requested → re-fire; implementing → PR poller picks up; reviewing → restart review loop; finalizing → re-run; spawn-requested with no remaining ack retries → orphan).
- `passes[]` — history of every foreman pass with trigger, status, started page ids, cost, transcript tail.
- `passInFlight` — whether the foreman is mid-pass right now.
- `foremanTerminalId` — set while a foreman PTY is alive. The Foundry panel uses this to render the live PTY view; cleared on decision or timeout.

The **Reset** button on the foundry settings card (shown only when the foundry is off) wipes all of that and keeps the config. Useful when state has drifted from reality and you want to start clean.

## Configuration reference

All in **Settings → Foundry** for the active project. Backed by `foundry-config.json` in the userData dir.

| Field | What it does |
|---|---|
| **Name** | Human label, shown in the panel header. |
| **Enabled** | Off / On toggle on the foundry card. Default: off (configure first, flip when ready). |
| **Implement prompt** | Multi-line textarea, sent verbatim to the worker session as its first message. Placeholders: `{{taskUrl}}`, `{{taskTitle}}`, `{{taskId}}`, `{{taskTitleSlug}}`. There is **no hidden suffix** — what you see is what gets sent. |
| **Ready-for-review prompt** (optional) | Multi-line textarea, injected into the worker's existing PTY during finalize. Placeholders include `{{prUrl}}`, `{{prNumber}}`, `{{branch}}` on top of the task placeholders. Empty = skip the worker step and use the foundry's auto-`markPRReady` instead. |
| **Branch name template** | Fallback when the foreman doesn't supply a branch name. Default: `foundry/{{taskTitleSlug}}`. |
| **Base branch** | The branch each pipeline branches off. Auto-created off the repo default if it doesn't exist on origin. |
| **Max concurrent tasks** | Hard cap on `freeSlots`. The foreman cannot exceed this — validation drops overflow entries. Default: 2. |
| **Task set filters** | OR-of-ANDs Notion filter (the same primitive the single-ticket integration uses). Defines which tickets this foundry watches at all. |
| **Eligibility filters** (optional) | Narrower filter for "of those, which are ready to start" (e.g. `Status = Not Started`). Foreman only picks from this subset. |
| **Completion transition** | Property + (optional) `from` + `to`. This is what tells the watcher "ticket X is done — pick the next unblocked task." Usually `Status: In review → Testing` or similar. |
| **Completed statuses** | Multi-select. Statuses the foreman treats as "dependency satisfied" **and already merged to trunk** when reasoning about order. |
| **Optimistic continue** | On/off (default off). When on, dependencies in an **optimistic status** also count as satisfied even though their PR hasn't merged yet — see below. Safe to toggle while the foundry runs; it takes effect on the next pass. |
| **Optimistic statuses** | Multi-select (shown when optimistic continue is on; default `In review`). Statuses meaning "PR open, not yet on trunk". A dependency in one of these is treated as satisfied **and its PR branch is merged into the dependent ticket** before work starts. |
| **On pickup** | Notion property updates applied the moment a pipeline starts (e.g. `Status: Not Started → In Progress`). Same editor as the single-ticket integration's pickup updates. |
| **On ready for review** | Notion property updates applied after `verifyPRReady` succeeds (e.g. `Status: → In review`). |

## Source pointers

- `src/main/services/foundry.service.ts` — the FSM, watchers, runtime state, pipeline lifecycle.
- `src/main/services/foundry-foreman.service.ts` — pass orchestration, context.json builder, prompt, decision validation.
- `src/main/services/claude-headless.service.ts` — shared headless claude runner (review loop uses it too; foreman now uses an interactive PTY instead).
- `src/main/ipc/foundry.ipc.ts` — IPC handlers + the `FOUNDRY_SPAWN_WORKER` mirror of `SCHEDULER_SPAWN_AGENT_WITH_PROMPT`.
- `src/renderer/components/foundry/FoundryPanel.tsx` — the right-sidebar panel + live foreman PTY view.
- `src/renderer/components/settings/FoundrySettings.tsx` — the settings UI.
- `src/renderer/hooks/useFoundryBootstrap.ts` — renderer-side worker materialisation (worktree + session + claude PTY + ack).
- `src/shared/types.ts` — all the types.
- `tests/unit/main/foundry.service.test.ts` + `tests/unit/main/foundry-foreman.test.ts` — unit coverage of the FSM and decision validation.

## Design choices, briefly

**Why file-contract decisions instead of MCP / tool calls?** Restartability (a pass that crashes mid-tool-call leaves no audit trail; a missing decision.json is unambiguous), and authority isolation (the LLM cannot directly start sessions — it can only suggest, gated by the validation layer).

**Why an interactive foreman PTY instead of headless `claude --print`?** The user wanted to watch the foreman think and be able to nudge it. The interactive PTY shows live activity, accepts ad-hoc input, and the file-watcher decision detection is the same regardless of how the foreman is spawned.

**Why no `--resume` across passes?** Earlier iterations did this so the foreman remembered prior decisions. In practice the file-contract `context.json` includes everything the foreman needs each pass (running pipelines, statuses, ticket bodies), and the conversation continuity created fragile coupling with claude's session storage layout. Each pass is now its own claude session — simpler, more predictable.

**Why does `Reset` only work when off?** So you can't yank state out from under live workers mid-implement. Cancel any active pipelines first if you really need to wipe.

**Why isn't toggle-off cancelling in-flight pipelines?** The contract is "off = no new work scheduled." Existing sessions keep doing real work that you might want to keep. If you want to actually stop them, cancel each from the panel.

## Optimistic continue

By default a dependency only unblocks the next ticket once it reaches a **completed status** (`Done`/`Testing`) — i.e. it's merged to trunk, so the next worktree (branched off trunk) already contains its code. That means the whole pipeline waits on human PR review, which can back up.

**Optimistic continue** (per-foundry toggle, default off) relaxes this. Statuses listed in **optimistic statuses** (default `In review` — PR open, *not* yet on trunk) also count as dependency-satisfied:

1. The foreman picks up the next ticket those dependencies unblock, and lists each unmerged dependency's pageId under `optimisticDependsOn` in its decision.
2. The FSM resolves each of those pageIds to its PR branch — from this foundry's own pipeline records first, then by searching open PRs for the dependency's Notion page id (the implement template puts the ticket URL in the PR body).
3. It prepends a deterministic **merge preamble** to the worker's implement prompt: `git fetch origin` + `git merge --no-edit origin/<dep-branch> …`, with a clear instruction to stop and report rather than guess if there are conflicts. The worker merges the prerequisite work into its branch, then implements on top.

The worktree is still branched off the configured base branch, and the PR still targets it — so the PR diff includes the dependency code until those dependencies merge to trunk. That's the optimistic trade-off: we assume the in-review PRs will be approved. If a dependency's branch can't be resolved, the pipeline is **parked with attention** instead of starting a worker that would be missing code. The watcher also wakes the foreman when a ticket *enters* an optimistic status, so the next ticket gets picked up promptly.

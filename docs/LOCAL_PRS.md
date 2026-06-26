# Local PRs

A **local PR** is a tracked record of a would-be pull request — title, body, branch, base, diff — that lives on your machine **between a draft branch and an open GitHub PR**. You can view and review it like a PR, then **promote** it to a real GitHub PR that pushes those exact details up.

```
 working branch ──► [Create local PR / captured gh pr create] ──► LOCAL PR ──► [Promote] ──► OPEN GitHub PR ──► merged
   (draft, local)                                            (viewable, reviewable,        (real PR, real CI)
                                                              promotable, stackable)
```

It's a **general, session-level** feature. [Foundry](FOUNDRY.md) is the biggest consumer: pointed at a backlog and run overnight, its workers each produce a local PR, building a chained stack you publish in one click.

---

## Producing a local PR

### From any session
- **Create local PR** (session action menu) — snapshots the session's branch/base into a record. Title/body default from the last commit and are editable before promote. The branch is pushed to origin so the record is always promotable.
- **Capture PRs locally** (per-session toggle) — puts a `gh` shim on the session's terminal PATH so the agent's PR commands are captured into the local record instead of hitting GitHub.

### Captured `gh` commands (capture mode)

When capture is on, the shim intercepts the PR-mutating commands and applies them to the local record; **everything else passes straight through to the real `gh`**:

| Command | Effect on the local PR |
|---------|------------------------|
| `gh pr create` | Creates the record (title/body/base/head). Returns a fake `LOCAL-<n>` URL so the agent's flow continues. |
| `gh pr edit` | Updates the stored title/body (e.g. the agent filling in the review checklist). |
| `gh pr ready` | Flags the record ready-for-review. |
| `gh pr view` | Serves the record's fields back (`--json` / `-q` aware) so the worker can read its own PR. |

Title and body are base64-encoded over the wire, so multi-line markdown bodies survive intact. The shim is a POSIX `sh` script written to the app's user-data dir and prepended to the worker's PATH only when capture is enabled.

---

## Reviewing & promoting

Local PRs appear in the normal PR list with a **Local** badge and **Promote to PR** / **Discard** actions. The session's **PR tab** renders the stored body (as markdown) plus the local diff (`branch` vs `base`) — there's no GitHub round-trip, so it works fully offline.

![A local PR in the PR list](screenshots/local-pr-card.png)

![The local PR review tab](screenshots/local-pr-panel.png)

**Promote** pushes the branch, opens a real draft PR from the approved title/body/base, marks it ready if the worker marked the local one ready, and the list entry becomes the real PR. Promote also **drops the gh shim** for the owning session — capture mode is turned off (in memory immediately, and the persisted per-session toggle is cleared so a restart doesn't re-enable it), so the agent's subsequent `gh` commands act on the real PR instead of being captured into a fresh local one.

---

## Foundry overnight stacks

Turn on **Local PR mode** in a Foundry's settings (with an optional integration branch — defaults to `foundry/integration-<id>`). An overnight run then builds a **chained stack**:

- The first pipeline's PR targets the integration branch; each subsequent PR targets its predecessor's branch.
- Each worker runs its **normal** finalize flow (including the ready-for-review prompt) — the captured `gh` commands stand in for the remote ones, so nothing hits GitHub yet.

In the morning, **Create PRs** walks the stack in creation order:

1. Promote → open the real draft PR with the correct (chained) base.
2. Run optional **local CI** in Docker (`act`) — on failure, resume the worker to fix and re-run (bounded retries).
3. Mark ready, then advance to the next PR.

The walk is **resumable**: a publish cursor is persisted, and each step is idempotent, so it continues cleanly after a restart. The [review loop](../README.md#review-loop) also runs against local PRs, storing its findings on the record instead of posting a `gh` sticky comment.

### Notes & limits

- **Local CI** uses [`act`](https://github.com/nektos/act) and needs Docker. It can't run private/Marketplace actions that require auth or real secrets, so treat it as high-confidence advisory — the real GitHub Actions run after promote remains the source of truth.
- A ready-for-review prompt that also updates Notion runs that Notion step **for real** during the overnight pass (it's not a `gh` command), so tickets can move to "in review" before the PRs are published.

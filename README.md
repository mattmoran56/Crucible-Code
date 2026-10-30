<p align="center">
  <img src="resources/icon.png" width="128" alt="CodeCrucible icon" />
</p>

<h1 align="center">CodeCrucible</h1>

<p align="center">
  IDE for agentic development — manage multiple Claude Code sessions in parallel, each in its own git worktree, with built-in diff viewer, PR reviews, and terminal.
</p>

<p align="center">
  <a href="LICENSE">MIT License</a> · <a href="CONTRIBUTING.md">Contributing</a>
</p>

<!-- TODO: Replace with actual screenshot -->
![CodeCrucible](docs/screenshots/hero.png)

## Features

- **Multi-project management** — Open multiple git repos, switch with draggable tabs, per-project notifications
- **Session isolation** — Each session gets its own git worktree and branch — no conflicts between parallel agents
- **Agents without a worktree** — A second button next to **+** in Sessions starts a short-lived agent straight in the main checkout (no worktree, no branch) for PR reviews and other non-code work, listed alongside your other sessions and named by Haiku from your first message
- **Cloud sessions & Teleport** — New sessions start in Claude Code on the web by default, so heavy builds and CI-style test runs happen off your machine. Watch and chat with it on the real claude.ai page embedded in the Agent tab, then hit **Teleport** to pull it down into the local worktree and carry on there
- **Embedded terminals** — Full xterm.js shell terminals per session, opened from the workspace tab bar
- **Git integration** — Commit log, changed files, and a GitHub-style syntax-highlighted diff viewer (Shiki) with full-file syntax context, click-anywhere context expansion, per-hunk collapse, and side-by-side or unified modes
- **PR review panel** — Review pull requests without leaving the IDE: conversation, checks, file tree, inline comments, merge
- **Intervention alerts** — Desktop notifications and dock badge when Claude Code needs your input
- **Usage tracking** — Rate limit bars and activity stats per session
- **Code editor** — CodeMirror editor with file explorer for editing files in any worktree
- **Themes** — Dark (Tokyo Night), Light, Soft Light, and Ultra Dark — terminal theme syncs automatically
- **Remote access** — Pair a second device's browser to your desktop instance over the LAN, or over a hosted end-to-end encrypted Cloudflare Worker relay that works through VPNs and hotel Wi-Fi. View projects, sessions, settings, and live agent terminals from anywhere (full mobile layout, PWA-installable on iOS)
- **Custom buttons** — Configurable action buttons that run shell commands or Claude prompts with placement, scope, and shortcut options
- **Sandboxer sandboxes** — Per-project opt-in: run a session's worktree as a [Sandboxer](https://github.com/mattmoran56/sandboxer-core) sandbox (one container with its own database and storage) from the Sandbox panel. Deleting the session destroys the sandbox and its data
- **Session startup prompts** — Pre-configure per-project prompts (e.g. `/notion-ticket {{input}}`) that become the first message of a new session's agent
- **Review loop** — One-click review → triage → fix cycle on a branch. Runs headless in the background by default (`claude -p`, no terminal — the panel streams each transcript), or flip a per-project toggle to run it as three live Claude Code terminals you can watch and steer. Pick a variant per project: **Lite**/**Pro** (three fresh sessions per round) or **Efficient** (fresh stacked reviews + one persistent worker that keeps context across rounds — cheaper). Stop conditions (clean rounds, iteration cap) and a sticky PR comment for skipped findings
- **Visual agents** — Every agent tab is a chat interface to Claude Code rather than a terminal — rich tool cards with diffs, inline permission and question cards, a sub-agent tray, `/btw` asides — side conversations in a fork, in their own slide-out panel — a model picker, and conversations that resume across app restarts
- **Keyboard navigable** — Full keyboard support: arrow keys, focus trapping, roving tabindex, accessible by default

## Visual Tour

<!-- TODO: Replace with actual screenshots -->

<table>
<tr>
<td width="50%">

**Git diff viewer**

Browse commits and view syntax-highlighted diffs inline.

![Git diff viewer](docs/screenshots/git-diff.png)

</td>
<td width="50%">

**PR review**

Review pull requests with conversation, checks, file tree, and inline comments.

![PR review](docs/screenshots/pr-review.png)

</td>
</tr>
<tr>
<td width="50%">

**Session management**

Sessions show live status: running (spinner), needs attention (dot), or completed (check).

![Sessions](docs/screenshots/sessions.png)

</td>
<td width="50%">

**Code editor**

Built-in CodeMirror editor with file explorer — edit files directly in any worktree.

![Editor](docs/screenshots/editor.png)

</td>
</tr>
<tr>
<td width="50%">

**Custom buttons**

Add configurable action buttons to the toolbar, top bar, or right sidebar.

![Custom buttons](docs/screenshots/custom-buttons.png)

</td>
<td width="50%">

**Button settings**

Full settings UI for creating, editing, and organizing custom buttons.

![Button settings](docs/screenshots/button-settings.png)

</td>
</tr>
<tr>
<td width="50%">

**Settings & themes**

Four built-in themes with automatic terminal sync, account management, and preferences.

![Settings](docs/screenshots/settings.png)

</td>
<td width="50%">

**Themes**

Dark (Tokyo Night), Light, Soft Light, and Ultra Dark.

![Light theme](docs/screenshots/theme-light.png)

</td>
</tr>
</table>

<details>
<summary><strong>Getting Started</strong></summary>

### Prerequisites

- Node.js 18+, npm
- A git repository to open as a project

### Dev mode

```bash
npm install
npm run dev
```

1. Click **Add Project** and select a folder containing a git repository.
2. Create a session from the sidebar — this creates a new branch and worktree.
3. Tell the session's agent what to work on in its Agent tab, or open a terminal from the **+** menu to run commands in the isolated worktree.
4. View commits and diffs in the git panel as your agent works.
5. Open PRs directly from the git panel toolbar.

### Native install (macOS arm64)

The native install runs from its own bundled assets, so switching branches in the source repo won't break the running app.

```bash
npm run dist
```

This builds and copies `Crucible Code.app` to `/Applications/`.

### Auto-update

The installed app polls `origin/main` every 5 minutes. When new commits land, an **Update Available** button appears in the title bar. Click it to pull, rebuild, and relaunch automatically.

</details>

<details>
<summary><strong>Remote access (web receiver)</strong></summary>

Pair a second device's browser to your desktop in one of two modes. Both serve the same React receiver — same projects, sessions, settings, live agent terminals. Architecture details live in [docs/REMOTE.md](docs/REMOTE.md); the cloud relay deep-dive is in [docs/cloud-relay.md](docs/cloud-relay.md).

| | LAN mode | Cloud mode |
|---|---|---|
| Transport | Embedded WebSocket server on the desktop | Outbound WSS to a hosted Cloudflare Worker relay |
| Requires same network | Yes | No — works through VPN, cellular, hotel Wi-Fi |
| Third party in path | None | Relay (forwards opaque ciphertext only) |
| Encryption | TLS to the LAN listener | TLS + libsodium end-to-end (X25519 + XChaCha20-Poly1305) |
| URL on the phone | `https://<desktop-ip>:<port>` | `https://codecrucible-relay.mattmoran56.workers.dev` |

### LAN mode

Flip the LAN toggle in the desktop top-bar popover. The phone loads the receiver from the desktop and pairs with a 6-char code (single-use, 5-minute TTL); the browser swaps it for a long-lived token stored in `localStorage`.

![Pairing](docs/screenshots/remote-pair.png)
![Project list on desktop browser](docs/screenshots/remote-projects-desktop.png)
![Live session terminal](docs/screenshots/remote-session-desktop.png)
![Mobile drawer](docs/screenshots/remote-drawer-mobile.png)
![Mobile settings](docs/screenshots/remote-settings-mobile.png)

### Cloud mode

Flip **Cloud relay** on in the same popover. The desktop opens an outbound WSS to the hosted relay and registers a handle (e.g. `silver-otter-79`). On the phone, open `https://codecrucible-relay.mattmoran56.workers.dev`, type the handle and 6-char pairing code shown in the popover, and you're paired. On iOS you can install the page via Safari → Share → **Add to Home Screen** to get a standalone PWA with manifest, service worker, notch padding, and sticky tabs.

![Cloud relay popover with handle + code](docs/screenshots/cloud-relay-popover.png)
![Receiver handle entry page](docs/screenshots/cloud-receiver-handlepage.png)
![Receiver safety-number panel](docs/screenshots/cloud-receiver-settings-safety-number.png)
![Desktop approval prompt](docs/screenshots/pairing-approval-prompt.png)

### Security model

End-to-end encrypted in both modes. Cloud mode adds a libsodium handshake on top of TLS: ephemeral X25519 key exchange, HKDF salted with the pairing code (first pair) or bearer token (reconnect), then XChaCha20-Poly1305 on every frame. A 6-digit **safety number** derived from the shared key is displayed on both ends so the user can visually confirm there's no MITM. The relay forwards opaque ciphertext only — it never sees the pairing code, IPC payloads, or terminal output. An optional **approval gate** on the desktop requires the user to Approve or Deny each incoming pairing attempt, closing brute-force of the derived ticket as an attack class. The relay layer adds KV-gated handles (no enumeration), per-IP rate limits on `/register` and `/phone`, and 30-day TTL cleanup of idle handles. Full threat model in [docs/cloud-relay.md](docs/cloud-relay.md).

### Implementation notes

- **Same code paths as the desktop renderer** — `req` frames hit the shared `handlerMap` that `ipcMain.handle` registers, so the relay can never drift from the local UI for the channels it forwards.
- **Live terminal attach with backfill** — Receiver attaches to the *existing* PTY for `(sessionId, tabId)`; the desktop's `terminal.service` keeps a 64 KiB tail per terminal so a remote join shows recent context, then streams new output live. Typing on either device drives the same shell.
- **Mobile layout** — Below 768 px the project tabs collapse into a slide-in drawer, the workspace tab strip grows to thumb-friendly h-14 with full-width accent bar, and the theme picker moves into Settings as a chunky radio list (web-only, independent from the desktop).
- **Out of v1 scope** — Pull requests, env-var sync, and repo cloning to the remote machine.

### Self-hosting the relay

The Worker source is in [`relay-worker/`](relay-worker/README.md) — `npx wrangler deploy` puts it on your own Cloudflare account. Point the desktop at it by setting `RELAY_BACKEND_URL=https://your-relay.example.workers.dev` before launching the app.

</details>

<details>
<summary><strong>Multi-project management</strong></summary>

Open multiple git repositories as projects. Each project gets its own tab in the top bar.

- **Draggable tabs** — Reorder projects by dragging
- **Per-project state** — Active session, PR selection, and workspace layout persist when switching between projects
- **Per-project accounts** — Assign different Claude accounts to different projects for isolated billing and auth
- **Notification badges** — Tab badges show how many sessions need attention across all projects
- **Confirm close** — Closing a project tab prompts for confirmation to prevent accidental removal

</details>

<details>
<summary><strong>Sessions & worktrees</strong></summary>

Each session creates a git worktree at `<repo-parent>/.codecrucible-worktrees/<repo>/<session>/` with its own branch (`session/<name>`).

- **Create from scratch** — New branch from any base branch. The dialog's **Branch** field shows the branch the session will get (`session/<name>` by default, following the name as you type) and you can change it
- **Cmd+N shortcut** — Opens the New Session dialog from anywhere in the app
- **Cloud or local** — The New Session dialog has a **Cloud / Local** toggle. Cloud (the default, configurable per project) runs the agent in Claude Code on the web; Local runs it in the worktree (see **Cloud sessions & Teleport** below)
- **Human-readable names** — Name a session however you like (`Fix Auth Bug`); its default branch and worktree folder use the name lowercased with spaces turned into hyphens (`session/fix-auth-bug`)
- **Agent tab** — Every session opens on its Agent tab: a visual agent (see **Visual agents** below) running in the worktree, or for a cloud session, the claude.ai session page embedded in the app with a **Teleport** button that brings it down into a visual agent
- **Links open beside the conversation** — Clicking a web link in the Agent tab (in a visual agent's reply, or on a cloud session's claude.ai page) slides a browser in from the right, and the conversation and message bar move over to make room. It starts half and half; drag the divider to resize (double-click it, or press Enter on it, to go back to half and half). The toolbar has back, forward and reload, **Open in browser** to send the page to your default browser, and **×** to close the panel. Cmd-click a link to skip the panel and open it in your default browser. The panel shares the embedded claude.ai page's browser profile, so you stay signed in wherever you signed in there. It runs sandboxed with no access to the app, loads only web pages (no `file:` or app links), and links that would open a new window load in the panel instead. Each session keeps its own panel, and it survives switching sessions or moving the Agent tab to another column
- **Cloud badge** — Sessions running in the cloud show a small **Cloud** badge on their sidebar card
- **Agents without a worktree** — The chat-bubble-with-a-plus button next to **+** opens a new agent in the project's main checkout straight away: no dialog, no worktree, no branch — the same thing as an agent tab in the Code workspace, but listed in Sessions so every agent is in one place. Handy for reviewing PRs, asking questions or other non-code work. It starts as `agent-1`, `agent-2`, …; the first message you send names it — one quick, tool-less Claude Haiku turn on the project's Claude account (`claude -p --model haiku`, a fraction of a cent, not saved to your resume list) turns it into a short name like `review-pr-143-uploads`. Slash commands don't count, and a name you pick from the `⋯` menu (even before the suggestion lands) is never overwritten. Its card shows a **No worktree** badge next to the branch the main checkout is on. It opens on just its Agent tab; add more agents or terminals (also in the main checkout) from the column's **+** menu. Deleting it stops its agents and terminals and never touches the repo
- **Import existing worktree** — Bring in worktrees created outside CodeCrucible
- **Open remote branch** — Create a session from a remote branch with autocomplete
- **Open as main branch** — Temporarily check out a session's branch on the main repo (useful for builds that need the real repo path)
- **Rename a session** — Give a session a more identifiable name from the card's `⋯` menu. The underlying git branch is renamed to match (lowercased, spaces as hyphens) when it is still the default `session/<name>`; a custom branch, or a cloud (or teleported) session's branch, stays as it is
- **Delete a session** — Removes the worktree and the local branch the app created. For a cloud (or teleported) session the confirm dialog also offers, unticked by default, to delete the branch on origin. Any Sandboxer sandbox built from the worktree is destroyed first (see **Sandboxer sandboxes** below)

![Rename session dialog](docs/screenshots/rename-session-dialog.png)

![An agent without a worktree, open on its Agent tab in the main checkout](docs/screenshots/repo-agent-session.png)

![A link from the conversation open in the Agent tab's link browser](docs/screenshots/agent-browser-link-open.png)

</details>

<details>
<summary><strong>Cloud sessions & Teleport</strong></summary>

Run a session's agent in [Claude Code on the web](https://claude.ai/code) instead of on your machine, watch it from the app, and bring it down locally when you want to test.

- **Cloud by default** — New sessions start in the cloud unless the project's **Settings → Project Defaults → Default session location** is set to **Local**. The New Session dialog's **Cloud / Local** toggle starts from that default; Local behaves exactly as before
- **Starting one** — The app owns the branch: the worktree is created on the branch from the dialog's **Branch** field (from `origin/<base>`), the session is saved and the dialog closes. Its Agent tab then pushes the branch to GitHub (`git push -u origin <branch>`) and runs `claude --cloud "<task>" --on-branch <branch>` in a terminal right in the tab. Starting a cloud session is interactive in Claude Code, so if it asks anything (send this machine's settings, use its MCP servers, sign in) you answer it there. As soon as the CLI prints the new session's claude.ai/code link, the app saves it and the tab switches to the embedded page. If the CLI stays attached to the session, a **Local CLI still attached** bar lets you look at it or **Close** it (the cloud session keeps running). `--on-branch` makes the cloud agent check out and push to exactly the app's branch instead of a generated `claude/...` one (a CLI without the flag is retried without it), and the task is prefixed with a short instruction to commit and push only to that branch. Claude Code on the web does not restrict which branches it pushes to, so the default stays `session/<name>`; the repository's default branch can't be used. A cloud session needs a task: the chosen startup prompt, or what you type in the dialog's **Task** box. If the CLI exits without creating a session, its output and the error stay in the tab with **Retry**, **Open claude.ai/code** and **Delete session…**; the worktree is kept. A session whose creation was cut short by quitting the app offers the same on its next launch, rather than starting a second cloud session on its own
- **Connectors from the first turn** — claude.ai only attaches your connectors (Notion, Slack, Gmail and the rest) to a cloud session when a message from the claude.ai page arrives; the CLI's create message carries none, so a session that started work straight away ran its first turn without them. So the task is also prefixed with an instruction to hold (reply that it is ready, run no tools), and as soon as the session exists the app sends a short **Start the task now** message from the session's embedded claude.ai page (loaded in the background if the tab isn't on screen), which brings the connectors in with it. If the page can't send it within 90 seconds (for example you aren't signed in to claude.ai in the tab), the app sends the same message with `claude -p --cloud <id>` instead so the task still starts, and tells you to send any message from the claude.ai page to attach the connectors. A kickoff cut short by quitting the app runs again on the next launch
- **Single branch or orchestrator** — A cloud session in the New Session dialog is either **Single branch** (the default: pinned with `--on-branch` and told to commit and push only to its branch, as above) or **Orchestrator**. An orchestrator starts on the session branch but is not pinned to it (no `--on-branch`), and its task is prefixed instead with an instruction that it may create, check out, merge and push whichever branches the task needs, and list every branch it touched when it finishes
- **Watching it** — The Agent tab shows the session's real claude.ai/code page embedded in the app, so you watch and chat exactly as on the web. Each cloud session's page stays loaded like a browser tab: switching to another session (or moving the Agent tab to another column) and back is instant, with scroll position and anything you were typing intact. Up to 8 pages stay live; the least recently used is closed beyond that, and a session's page is closed when it is deleted or teleported. Sign in to claude.ai inside the tab once; it remembers you (a dedicated, persistent browser profile separate from the rest of the app). The toolbar shows a **Cloud** badge, the session id, the session's branch and **Open in browser**. If the page fails to load you get **Retry** and **Open in browser**
- **Embedded page safety** — The page runs sandboxed with no access to the app, can only navigate within claude.ai / anthropic.com and the Google, Apple and GitHub sign-in pages (any other link opens in the Agent tab's link browser, see **Sessions & worktrees**), and is denied every permission except copying to the clipboard. Enterprise SSO sign-in, which goes to your identity provider, opens in the browser, so use **Open in browser** in that case
- **Queued messages** — A queued follow-up for a cloud session is sent to the cloud session (`claude -p "<message>" --cloud <id>`), not to a local agent
- **Teleport** — The **Teleport** button asks to confirm, checks the worktree has no uncommitted changes (if it does it lists them and stops; nothing is stashed for you), then runs `claude --teleport <id>` in the worktree. The tab shows a **Teleporting…** checklist of the CLI's steps (validating the session, fetching the conversation, getting branch info, checking out the branch, loading the conversation), with **Show terminal** to see the CLI itself. If Claude stops to ask something (stash, sign in, trust the folder, pick a checkout) the terminal opens on its own so you can answer. Once the conversation is saved locally, the app closes the CLI and the tab becomes a visual agent resuming that conversation, with its full history from the cloud session, and the session's **Cloud** badge goes away. Current Claude Code only writes a teleported conversation to disk after its first new message, so once the CLI has loaded it and is idle at its prompt (no dialog showing) the app types one fixed, harmless message for you ("Teleport to this machine succeeded. This is an automated message from Crucible Code: take no action and reply only with 'Ready.'"), shown as a **Saving the conversation locally** step; once Claude has replied and the conversation is saved, the tab switches to the visual agent on its own, where that exchange appears as a single collapsed **Teleported from the cloud** note. It is sent at most once per teleport. If that saves nothing within a minute, the terminal opens (with the cursor in it) under a **Send any message below to finish bringing this session down** banner; once Claude has saved it, the header reads **saved locally — open in Agent view** and **Open in Agent view** appears (the app never closes the CLI on you once it is yours). If Claude Code reports that transcript saving is off, the teleport stops at once and says why instead of waiting forever. Until something is saved the only way out is **Cancel teleport**, which closes the CLI and leaves the session in the cloud. If nothing moves for two minutes the tab says so and shows the terminal. A teleport that ends with nothing saved locally (cancelled, the CLI killed, the app quit) is not treated as local: the session goes back to the embedded claude.ai page with a **Teleport didn't finish — nothing was saved locally** notice and **Teleport again**, so the cloud conversation is never swapped for a fresh agent. If the CLI exits early, its output and **Close teleport** stay in the tab. The app also reads the worktree's current branch: if the teleport checked out a different branch than the one the app created, the session follows the real branch and a notice says so, with an optional **Delete unused branch…** (local and origin, behind a confirm). Nothing is renamed or deleted on its own
- **After a restart** — A session teleported in an earlier run (or whose teleport was interrupted) opens the same way: the app finds the teleported conversation's transcript under your Claude config's `projects/` directory and resumes it as a visual agent with its whole history. If it can't find one, the teleport never finished: on load the session goes back to the cloud page with the **Teleport didn't finish** notice and **Teleport again** (sessions already stuck that way from older versions are moved back too)
- **Requirements** — Signed in to claude.ai in the Claude Code CLI (for the project's Claude account), and the repo on GitHub with the Claude GitHub App installed
- **Scheduled sessions** — Scheduled and Notion-started sessions still run locally, on the default `session/<name>` branch
- **Permissions** — No `--permission-mode` or bypass flag is passed to any of these commands; they run in your default (auto) mode

![Starting an orchestrator cloud session](docs/screenshots/new-session-dialog-orchestrator.png)

</details>

<details>
<summary><strong>Session startup prompts</strong></summary>

Configure per-project prompts that can optionally auto-run in a new session's agent. Pick one when creating a session — it becomes the Agent tab's first message.

- **Per-project list** — Each project gets its own set of prompts, configured in Settings → Session Startup Prompts
- **Slash commands or freeform** — Use Claude slash commands (`/notion-ticket`, `/run-tests`) or any freeform prompt
- **Optional input** — Use `{{input}}` in the command to ask the user for a value (e.g. a ticket URL) when creating the session
- **None by default** — Picking nothing keeps the existing behavior; the dialog only shows the picker when prompts are configured for the project

![New Session dialog with startup prompts](docs/screenshots/new-session-dialog.png)
![Picking a prompt that takes input](docs/screenshots/new-session-dialog-with-input.png)
![Per-project startup prompt settings](docs/screenshots/startup-prompt-settings.png)
![Adding a startup prompt](docs/screenshots/startup-prompt-editor.png)

</details>

<details>
<summary><strong>Terminal management</strong></summary>

Sessions can open embedded terminals (xterm.js + node-pty) in the worktree directory. The Agent tab itself is a visual agent (see **Visual agents** below), not a terminal — except while a cloud session is being created, when the Agent tab shows the `claude --cloud` terminal (afterwards it is the embedded claude.ai page).

- **New Terminal** — Add shell terminals from the workspace tab bar's **+** menu
- **Claude terminals elsewhere** — Foreground Claude custom buttons and the interactive review loop still run Claude Code in a terminal you can watch and type into
- **Theme sync** — Terminal colors update when you change the app theme
- **Claude Code theme** — Separately configurable light/dark theme for the Claude Code CLI
- **Intervention detection** — Terminal output is scanned for permission prompts and questions, triggering notifications

</details>

<details>
<summary><strong>Visual agents</strong></summary>

![Visual agent](docs/screenshots/visual-agent.png)

The agent interface: a chat UI for Claude Code, driven over `claude -p --input-format stream-json` instead of a terminal. There is no setting — every local session's **Agent** tab is a visual agent, and no Claude terminal is spawned for it. (A cloud session's Agent tab shows the embedded claude.ai session page instead; see **Cloud sessions & Teleport**.)

- **Opening one** — Each session's Agent tab starts one (a startup prompt becomes its first message). **New Agent** in the workspace tab bar's **+** menu opens another, labelled **Agent N**; **New Terminal** still opens a plain shell. Agent tabs from layouts saved before this change open as visual agents too
- **Code workspace** — **New Agent** in the Code (editor) view opens a visual agent in the repo root too. These aren't tied to a session, so they start a fresh conversation after an app restart
- **Background sessions** — Notion task pickups and scheduled sessions start the new session's visual agent with their prompt, and queued messages are sent to it, without opening the session
- **Images and files** — Drop images or any other files anywhere on the agent, paste them (a screenshot from the clipboard), or pick them with the **+** button beside the composer. They wait as chips (images with a thumbnail) above the message and can be removed before sending; a message can be just attachments. Each file is saved to a per-agent folder in your temp directory (never the worktree) that the session can read (`--add-dir`), and the message names its path so Claude can open it; PNG, JPEG, GIF and WebP images up to 5 MB also go in as image blocks so Claude sees them directly. Up to 10 files of 20 MB each per message. Sent messages show their attachments as chips

  ![Attachments in the composer](docs/screenshots/visual-agent-attachments.png)
- **Model picker** — Choose Opus, Fable, Sonnet or Haiku below the composer (or with `/model`); switching mid-conversation keeps the conversation
- **Dictation mode** — The **Dictation** toggle beside the model picker (on by default) sends text pasted into the composer straight away, as if you had pressed Enter, so a dictation app that pastes what you said sends it hands-free. It sends the whole draft, including anything typed before the paste; pasted images are still just attached. Turn it off to have pasted text wait for Enter or **Send**. The setting applies to every agent and is remembered across restarts

  ![Dictation toggle beside the model picker](docs/screenshots/visual-agent-dictation.png)
- **Smart dictation** — **Settings → Dictation** picks how dictation mode decides what to send. **Smart** (the default) only sends a paste your dictation app made, so text you copy and paste yourself waits for Enter. It tells them apart by the clipboard: dictation apps such as Wispr Flow mark the text they paste as transient (the nspasteboard.org convention) and put your own clipboard back straight after, while a copy of your own carries no mark. **Normal** sends every text paste, for a dictation app that doesn't mark its pastes. Password managers mark copied passwords the same way, so pasting one in smart mode sends it too

  ![Dictation settings with Smart and Normal](docs/screenshots/dictation-settings.png)
- **Tool cards** — Each tool call is a card: edits render as syntax-highlighted diffs, Bash shows the command and its output, reads and searches collapse into a one-line summary you can expand
- **Permission and question cards** — When Claude needs approval (or asks a question with options) the card appears inline with Allow / Always allow / Deny, and the status bar switches to **Needs you**
- **Sub-agents** — Tasks Claude spawns appear in a tray above the composer; click one to open its full thread in a sheet that slides in from the right. Each pill shows whether its agent is working, finished, failed or stopped. A background agent stays *working* until it actually ends, not just until it launches. The sheet has its own message box: what you type there goes to that sub-agent (Claude passes it on with `SendMessage`, which resumes the agent if it has already finished), and it shows in the sub-agent's thread
- **`/btw` asides** — Ask something without derailing the run: `/btw <question>` (or **Ask aside**) forks the conversation into a no-tools side session that opens in its own full-height panel, sliding out from the right edge of the tab with an accent border. The aside has its own chat bar, so it is a secondary conversation you can carry on — each follow-up resumes the fork, never the main conversation — then close (✕ or Esc) to go back to the main chat; its marker in the main conversation reopens it. If the link browser is open, it stays between the main chat and the aside. The aside's divider drags to resize (double-click resets it). Nothing said in an aside goes back into the main conversation
- **Slash menu** — Type `/` for every command the session's Claude Code offers, fuzzy-matched as you type: the panel's own `/btw`, `/model` and `/clear` (fresh conversation), then the repo's and your own commands and skills (`.claude/commands`, `.claude/skills`, plugins) with their descriptions and argument hints, then Claude Code's built-ins (`/compact`, `/init`, `/review` and more). The list comes from Claude Code itself when the session starts and updates when it discovers new skills mid-session. Enter runs the highlighted command straight away; Tab just inserts it so you can add arguments (commands that need one, like `/btw <question>`, are always inserted)
- **Stop / interrupt** — `Esc` or **Stop turn** interrupts the current turn; **End session** stops the process; **Restart** brings it back on the same conversation
- **Resume** — Each visual agent's Claude session id and model are saved on the session, so after an app restart the tab picks up the same conversation (its transcript is replayed from disk)
- **Permissions** — Runs in your default (auto) permission mode: no `--permission-mode` or bypass flag is ever passed, and the worktree's hooks are written exactly as for terminal agents

![Adding a visual agent tab](docs/screenshots/visual-agent-add-tab.png)

![A /btw aside open beside the main conversation](docs/screenshots/visual-agent-aside.png)

![The link browser between the main chat and an aside](docs/screenshots/agent-browser-with-aside.png)

![The slash menu listing the repo's commands and skills](docs/screenshots/visual-agent-slash-menu.png)

</details>

<details>
<summary><strong>Git integration</strong></summary>

Built-in git panel with commit history, changed files, and a GitHub-style diff viewer.

- **Commit log** — Scrollable list with polling for new commits
- **Changed files** — Both committed and working-tree changes, with right-click stage / unstage / stash / discard / reveal in Finder
- **GitHub-style diff viewer** — Three-zone rows (gutter / indicator / body) with tabular line numbers and progressive tinting so changes pop without overwhelming the surrounding context
- **Unified or side-by-side** — Toggle between the two modes per file; choice sticks across files
- **Full-file syntax context** — Syntax highlighting (Shiki) splices the visible hunk back into the whole-file blob before tokenising, so hunks that start mid-class or mid-string still highlight correctly
- **Click-anywhere context expansion** — The "Show N unchanged lines" strip is one big click target; the discrete ↑20 / ↓20 / ⇕all buttons override that default for fine-grained control. Works in both the worktree diff and PR diff.
- **Per-hunk collapse** — Click any `@@` row to fold a hunk; "Collapse hunks" toggle in the diff header collapses every hunk in the file
- **Commit status indicators** — Unpushed commits and new branches are marked
- **Push & PR** — Push button, open PR button, and merge controls with conflict detection
- **Working file diffs** — View uncommitted changes alongside commit diffs

<table>
<tr>
<td><img src="docs/screenshots/diff-viewer/storybook-diff-unified.png" alt="Unified diff with the GitHub-style gutter, indicator, and body zones" /></td>
<td><img src="docs/screenshots/diff-viewer/storybook-diff-split.png" alt="Side-by-side diff in split mode" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/diff-viewer/storybook-diff-unified-expanded.png" alt="Unified diff after expanding context between two hunks" /></td>
<td><img src="docs/screenshots/diff-viewer/storybook-diff-split-expanded.png" alt="Split diff after expanding context between two hunks" /></td>
</tr>
</table>

</details>

<details>
<summary><strong>PR review</strong></summary>

Full pull request review without leaving the IDE — comparable to GitHub's web UI for the day-to-day review loop.

- **Opens in its own worktree** — Clicking a PR creates a worktree at `<repo-parent>/.codecrucible-worktrees/<repo>/pr-<n>/` (via `gh pr checkout`, so forks work too) rather than swapping the main repo onto the PR branch. The main repo's branch is left alone. The worktree is reused if you click the same PR again, and torn down automatically once the PR is merged, closed, or disappears upstream
- **Conversation tab** — PR description, timeline, and CI checks with markdown rendering
- **Reviewers** — Approved / Changes requested / Awaiting review groupings, plus a typeahead "Request review" picker
- **Header summary** — At-a-glance "X approved · Y changes requested · Z pending" pill in the toolbar
- **Commits tab** — Per-commit diffs with prev/next navigation
- **File tree** — Changed files with viewed-file tracking and unresolved-comment badges
- **Scrollable diff view** — Lazy-loaded per file, optimised for very large PRs
- **Click-anywhere context expansion** — The "Show N unchanged lines" strip between hunks is one big click target (defaults to expand-all for a known gap, expand-down for a tail). The discrete ↑20 / ↓20 / ⇕all buttons inside the strip override that default for fine-grained control. Surrounding lines are pulled from the head SHA.
- **Per-hunk collapse** — Click any `@@` row to fold a hunk; "Collapse hunks" toggle in the diff header collapses every hunk in the file
- **Inline threads** — Reply to and resolve / unresolve review threads inline; resolved threads collapse to one line
- **Suggestion blocks** — `` ```suggestion `` blocks render as a side-by-side preview with an Apply button that writes to the worktree and creates a commit
- **Submit reviews** — Approve, request changes, or leave a comment
- **Merge** — Merge / squash / rebase with mergeability checks
- **Sidebar sort & filter** — Per-repo sort (PR number, recently updated, recently created) and filters (status, assignee, author, review-requested, CI status, unseen-only). "Me" pinned at the top of every person picker so the common case is one click
- **Sidebar display options** — Per-project control over which fields each PR card shows. Toggle the existing fields (state, CI, badges, branches, author) plus labels (with all/only-selected filter), requested reviewers, reviewer states, assignees, comments count, and updated time. An editable default applies to projects without overrides; per-project cards show a "Customized" pill and a Reset to default button

<table>
<tr>
<td><img src="docs/screenshots/pr-review-reviewers-mixed.png" alt="Reviewers section with mixed states" /></td>
<td><img src="docs/screenshots/pr-review-inlinethread-open.png" alt="Inline review thread" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/pr-review-suggestion-multiline.png" alt="Suggestion block" /></td>
<td><img src="docs/screenshots/pr-review-contextmenu-changedfiles.png" alt="Right-click context menu on changed files" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/pr-sort-filter-menu.png" alt="Sidebar PR sort and filter menu" /></td>
<td><img src="docs/screenshots/pr-sort-filter-menu-people.png" alt="Sidebar PR person filter picker" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/pr-card-all-fields.png" alt="PR card with all display fields enabled" /></td>
<td><img src="docs/screenshots/pr-display-settings-full.png" alt="Per-project PR list display settings" /></td>
</tr>
</table>

</details>

<details>
<summary><strong>Notion task integration</strong></summary>

Poll a Notion database for new tasks and auto-spawn a session per task. Sessions created this way carry a link back to the originating Notion page so you can jump straight to the ticket from the sidebar.

- **Auto-create sessions** — A poller watches your configured database every ~5 s; new rows matching your filters fire a session with the branch name, session name, and startup prompt resolved from page placeholders
- **OR filter groups** — Define multiple filter groups in the settings UI; a task is picked up if it matches *any* group (groups ORed; conditions within a group ANDed). Useful for "assigned to me in Project A *or* on the urgent list in Project B"
- **Ticket link under branch name** — The session card shows a small ticket icon and the page title beneath the branch. Clicking it hands off to your OS so it opens in the Notion desktop app (if installed) or your default browser — never inside Electron

![Session card with Notion ticket link](docs/screenshots/session-card-notion-ticket.png)

![Notion settings with multiple OR filter groups](docs/screenshots/notion-settings-multiple-groups.png)

</details>

<details>
<summary><strong>Sandboxer sandboxes</strong></summary>

[Sandboxer](https://github.com/mattmoran56/sandboxer-core) turns a git worktree into a running copy of the whole project: one container per branch with its own database, file storage and services, reachable at `https://<slug>--<app>--<project>.sbx.localhost`. The `sandboxer` CLI must be installed (`sandboxer doctor` checks the machine).

- **Off by default, per project** — Turn it on in **Settings → Sandboxer** and point it at the project's `sandboxer.yaml`. The path defaults to `sandboxer.yaml` at the repo root and can be any path relative to the root, or absolute. The card shows whether the file exists, how git sees it, and whether the CLI is installed
- **Config kept out of git** — A config that is not committed (e.g. listed in `.git/info/exclude`) never reaches a worktree on its own, so the app copies it to `<worktree>/sandboxer.yaml` before every start and makes sure it is excluded there too. A worktree that commits its own `sandboxer.yaml` is left alone. Because of the copy, `sandboxer up` also works by hand from a session's terminal
- **Sandbox panel** — A box icon in the right activity bar (only for enabled projects) shows the active session's sandbox: its state, a link per app, and **Stop** / **Start**, **Logs**, **Shell** and **Destroy**
- **Progress in the panel** — **Start sandbox** runs `sandboxer up` in the background and the panel shows it: the current step, elapsed time, the full output on demand, and **Cancel**. A failed run opens its output so you can see why
- **Is it up yet?** — Every link has a dot: green when the app answers, pulsing amber while it is still starting, grey when it is a front-end sandboxer has not built in this sandbox (with a **Build** button that runs `sandboxer reload --web <app>` as a job). A count shows how many are ready, and the panel checks every few seconds until they all are
- **Destroyed with the session** — Deleting a session, whether by hand or by cleanup (including PR review worktrees), runs `sandboxer down` for every sandbox built from the worktree, before the worktree is removed. That removes the container, database, uploads and its generated files. Anything that survives is reaped with `sandboxer gc` once the worktree is gone, and the app warns you if a sandbox still could not be destroyed
- **Startup sweep** — On launch, sandboxes whose session worktree no longer exists (e.g. deleted while Docker was down) are reaped with `sandboxer gc`

![Sandbox panel with link readiness](docs/screenshots/sandbox-panel-links.png)

![Sandbox panel while sandboxer up runs](docs/screenshots/sandbox-panel-building.png)

![Settings → Sandboxer](docs/screenshots/sandboxer-settings.png)

</details>

<details>
<summary><strong>Notifications & intervention detection</strong></summary>

Detects when Claude Code needs user input: visual agents report it from their run state (a permission or question card is waiting), and Claude terminals by scanning their output for permission prompts and questions.

- **Desktop notifications** — OS-level notifications when Claude needs attention
- **Dock badge** — macOS dock badge shows count of sessions needing input
- **Session status indicators** — Sidebar icons show running (spinner), attention (yellow dot), completed (green check)
- **Auto-clear** — Attention state clears when you navigate to the session
- **Cross-project** — Notification badges appear on project tabs for non-active projects too

</details>

<details>
<summary><strong>Usage tracking</strong></summary>

Monitor Claude Code usage and rate limits from the right panel.

- **Rate limit bars** — 5-hour and 7-day usage windows with visual progress bars
- **Session stats** — Cost, duration, lines added/removed per session
- **Activity chart** — Daily activity over the past week (messages, sessions, tool calls)
- **Subscription info** — Shows your current plan and rate limit tier
- **Auto-continue on limit** — When a session or agent actually hits its usage limit, a popup offers to queue a follow-up prompt that fires automatically once the window resets. The trigger watches terminal output for Claude's real "usage limit reached" banner (so for now it covers Claude terminals, not visual agents) — the message that genuinely blocks a conversation — not a usage percentage, so accounts with no hard limit (overage/extra usage) never mis-fire. Opt into Settings → Usage Limits to skip the popup and auto-queue `continue` for you

</details>

<details>
<summary><strong>Code editor</strong></summary>

Built-in code editor for when you need to make quick edits without switching apps.

- **CodeMirror 6** — Language support for JavaScript, TypeScript, Python, CSS, HTML, JSON, and Markdown
- **Code folding** — Fold-gutter chevrons let you collapse functions, classes, and any other foldable region; `Cmd-Alt-[` / `Cmd-Alt-]` keymap supported
- **File explorer** — Directory tree for any worktree, with file watching for external changes
- **Right-click context menu** — Open, copy relative/absolute path, reveal in Finder, delete file
- **Create and rename** — Create new files, rename existing ones from the explorer
- **Toggle mode** — Switch between editor view and terminal view from the workspace
- **Branch picker** — Click the branch label next to **Code** in the sidebar to search and switch branches. Branches with open PRs show a `#N` badge and a status dot (open / draft / merged). Switching with uncommitted changes prompts to either stash them or carry them onto the new branch.
- **Worktree tab** — The same commit log + working changes + diff viewer the session worktrees get, but pointed at the main repo so you can dig through history and uncommitted changes for whichever branch you have checked out.

<table>
<tr>
<td><img src="docs/screenshots/editor-branch-picker.png" alt="Branch picker dropdown showing branches with PR badges" /></td>
<td><img src="docs/screenshots/editor-worktree.png" alt="Worktree tab in Code mode showing commits, changed files, and diff viewer" /></td>
</tr>
</table>

</details>

<details>
<summary><strong>Notes</strong></summary>

Per-project notes panel accessible from the right activity bar.

- Create, edit, and delete markdown notes
- Useful for tracking session goals, review checklists, or project context

</details>

<details>
<summary><strong>Custom buttons</strong></summary>

Create configurable action buttons that run shell commands or Claude prompts from anywhere in the IDE.

- **Three placements** — Session toolbar, top project bar, or right activity bar
- **Two action types** — Shell commands or Claude prompts with template variable substitution (`{{branch}}`, `{{worktreePath}}`, `{{sessionName}}`, `{{repoPath}}`, `{{projectName}}`)
- **Two execution modes** — Background (silent with toast notification on completion) or terminal (interactive with live output)
- **Button groups** — Organize related buttons into dropdown menus
- **Scope control** — Global, all projects, or specific projects only
- **Keyboard shortcuts** — Assign Electron accelerator shortcuts (e.g. `Cmd+Shift+T`)
- **Confirmation dialogs** — Optional confirmation prompt before executing destructive actions
- **Icon picker** — 35+ built-in Lucide icons plus custom emoji support

</details>

<details>
<summary><strong>Review loop</strong></summary>

Automate the review → triage → fix cycle on a branch. There are three variants, chosen per project in **Settings → Review Loop** — **Lite**, **Pro**, and **Efficient**.

**Lite and Pro** run each round as three phases — Review, Triage, Implementation — in one of two run modes:

- **Headless (`-p`, the default)** — each phase runs as a background `claude -p` process with **no pseudo-terminal**, and the panel streams its transcript read-only. Because it uses no PTY, you can run many loops at once without hitting the macOS pseudo-terminal limit. It runs in your normal auto permission mode — never `--dangerously-skip-permissions` and never `--permission-mode acceptEdits`.
- **Interactive** — each phase opens a live Claude Code terminal side by side that you can watch and type into in real time, so you can step in and steer it whenever you want.

1. **Review** — A Claude terminal reviews the diff vs. base. In the Pro variant it writes structured findings to `.crucible/review-loop/round-N-issues.json`; in Lite it runs `/review` on the PR.
2. **Triage** — A second Claude terminal reads those findings and fans out a sub-agent per issue. Each sub-agent decides `fix` / `skip` / `defer` / `noop` and writes a short justification.
3. **Implementation** — A third Claude terminal applies the fixes, commits, and pushes.

In interactive mode each phase advances when its turn finishes (detected via Claude's `Stop` hook), then **freezes with a read-only "Completed" overlay** so its output stays readable but can't be edited; in headless mode the phase ends when the `claude -p` process exits. Either way the next phase starts in a fresh column, and every round opens a new row of three columns — so the whole history of a loop stays on screen.

**Efficient** is a token-frugal variant with a fixed two-panel topology. A *fresh* review genuinely benefits from clear, unbiased context every round, but triage and implementation don't — so it spends fresh context only where it matters:

- **Left** — a fresh, headless `claude -p` **review** per round, stacked newest-first. Clear context every round keeps each review honest.
- **Right** — **one long-lived, interactive worker** terminal that triages then implements for *every* round, keeping its conversation across the whole loop. Because it remembers earlier rounds, it won't re-litigate issues it already deliberately skipped or deferred. Round 1's review is handed to it at spawn; later rounds' reviews are pasted into the live session, and each turn advances on the worker's `Stop` hook.

This trades three fresh sessions per round (Lite/Pro) for one fresh review plus a persistent worker — much cheaper over a multi-round loop, with better continuity. The run-mode toggle doesn't apply (the topology is fixed); convergence is the same as Lite (a round with no new commit is "clean").

The loop stops on the first of: N consecutive clean rounds (default 2), iteration cap (default 5), or manual cancel. Phase terminals are swept when a loop finishes, when a new loop starts for the session, and when the session is closed, so PTYs never accumulate toward the macOS limit. Workspace defaults and per-project overrides live in **Settings → Review Loop**, including the headless/interactive run-mode toggle and a per-project toggle that hides the toolbar button and prevents the loop from running for that scope.

Skipped or deferred items get summarised in a single sticky comment on the open PR (using a hidden marker so subsequent rounds update the same comment instead of re-posting). That gives reviewers a record of what was knowingly left undone and why.

The Review Loop tab in the session workspace shows live progress: an overall status pill and current phase. In Lite/Pro that's three columns per round with their own status pills (each either a live terminal or a streamed headless transcript), per-round triage decisions, and a per-round log. In Efficient it's the two-panel layout instead — the stack of fresh reviews on the left and the single persistent worker terminal on the right.

<table>
<tr>
<td><img src="docs/screenshots/review-loop-running.png" alt="Review Loop tab while a loop is mid-triage" /></td>
<td><img src="docs/screenshots/review-loop-completed.png" alt="Review Loop tab after the loop converged" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/review-loop-headless.png" alt="Headless run: each phase streams its claude -p transcript read-only, no terminal" /></td>
<td><img src="docs/screenshots/review-loop-settings.png" alt="Workspace defaults and per-project overrides, including the variant and headless/interactive run-mode toggles" /></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/review-loop-efficient.png" alt="Efficient variant: stacked fresh reviews on the left, one persistent interactive worker on the right" /></td>
</tr>
</table>

</details>

<details>
<summary><strong>Architecture</strong></summary>

Three-layer Electron architecture with strict process isolation:

```
src/
├── main/            # Electron main process (Node.js)
│   ├── ipc/         # IPC handlers (one file per domain)
│   └── services/    # Business logic (git, worktree, terminal, notification)
├── preload/         # contextBridge — typed API on window.api
├── renderer/        # React UI (no Node.js access)
│   ├── components/
│   │   ├── ui/           # Base components (Button, Dialog, ListBox, TabBar, etc.)
│   │   ├── layout/       # App shell (ProjectTabs, SessionSidebar, SessionWorkspace)
│   │   ├── sessions/     # Session management (SessionCard, CreateSessionDialog)
│   │   ├── git/          # Git viewer (CommitList, ChangedFiles, DiffViewer)
│   │   ├── terminal/     # Terminals (DynamicTerminalPanel, ReviewTerminalPanel)
│   │   ├── editor/       # Code editor (CodeEditorPanel, FileExplorer)
│   │   ├── buttons/      # Custom buttons (CustomButtonBar, ButtonRenderer, IconPicker)
│   │   ├── pullrequests/ # PR review (PRReviewPanel, PRConversationTab, FileTree)
│   │   ├── notes/        # Notes panel
│   │   └── usage/        # Usage tracking panel
│   ├── stores/      # Zustand state (14 stores)
│   ├── hooks/       # Shared hooks (useResizable, useFocusTrap, useRovingIndex)
│   └── styles/      # Tailwind + CSS custom property themes
└── shared/          # Types, constants, patterns shared across processes
```

### Tech stack

- **Runtime**: Electron 33 (main + renderer)
- **UI**: React 19, TypeScript, Tailwind CSS 4
- **Build**: electron-vite 5, Vite 8
- **State**: Zustand (14 stores)
- **Terminal**: xterm.js + node-pty
- **Git**: simple-git
- **Syntax highlighting**: Shiki
- **Code editor**: CodeMirror 6
- **Markdown**: marked

### IPC

All communication between renderer and main process goes through typed IPC channels defined in `src/shared/constants.ts`. The renderer has no Node.js access — it communicates exclusively via `window.api`, exposed by the preload script with `contextIsolation: true`.

### Stays awake while running

So long-running work — terminals, Claude sessions, review loops and the remote relay — keeps running when you lock the screen and walk away, the app prevents the Mac from sleeping for its entire lifetime. It holds an Electron `powerSaveBlocker` of type `prevent-app-suspension` (started on launch, released on quit, re-armed after a forced sleep/resume), so the *system* stays awake while the *display* is still free to turn off when the screen locks. See `src/main/services/keep-awake.service.ts`. No setting — it's always on while the app is open.

</details>

<details>
<summary><strong>Theming</strong></summary>

Four built-in themes: **Dark** (Tokyo Night, default), **Light**, **Soft Light**, and **Ultra Dark**.

Themes are defined as CSS custom properties in `src/renderer/styles/globals.css`. Tailwind utilities reference these properties via the `@theme` block, so switching themes is instant and all components respond automatically.

Terminal colors sync with the app theme. The Claude Code CLI theme (light/dark) can be configured separately in settings.

To add a custom theme, add a `[data-theme="your-theme"]` block with the same property names:

```css
[data-theme="your-theme"] {
  --color-bg: #...;
  --color-text: #...;
  --color-accent: #...;
  /* see globals.css for the full list */
}
```

</details>

<details>
<summary><strong>Keyboard shortcuts</strong></summary>

| Key | Action |
|-----|--------|
| Arrow Up/Down | Navigate lists (sessions, commits, files) |
| Arrow Left/Right | Navigate tabs |
| Enter / Space | Activate selection |
| Escape | Close dialogs, settings, panels |
| Tab | Standard focus navigation |

All interactive elements use `focus-visible` rings — visible on keyboard navigation, hidden on mouse clicks.

</details>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: PR descriptions should explain the **intent and prompt** behind the change, not just the code. Features are accepted based on whether the aim fits the project.

## License

[MIT](LICENSE) — do whatever you want with it.

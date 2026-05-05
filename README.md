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
- **Embedded terminals** — Full xterm.js terminal per session with dynamic shell and Claude terminals
- **Git integration** — Commit log, changed files, and syntax-highlighted inline diffs (Shiki)
- **PR review panel** — Review pull requests without leaving the IDE: conversation, checks, file tree, inline comments, merge
- **Intervention alerts** — Desktop notifications and dock badge when Claude Code needs your input
- **Usage tracking** — Rate limit bars and activity stats per session
- **Code editor** — CodeMirror editor with file explorer for editing files in any worktree
- **Themes** — Dark (Tokyo Night), Light, Soft Light, and Ultra Dark — terminal theme syncs automatically
- **Custom buttons** — Configurable action buttons that run shell commands or Claude prompts with placement, scope, and shortcut options
- **Session startup prompts** — Pre-configure per-project prompts (e.g. `/notion-ticket {{input}}`) that auto-run in a new session's agent terminal
- **Review loop** — One-click review → triage → fix cycle on a branch with stop conditions (clean rounds, iteration cap, cost cap) and a sticky PR comment for skipped findings
- **Claude Web sessions** — Surface your own `claude/*` branches from Claude Code on the web in the sidebar; click to open them locally as worktrees
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
3. Use the terminal to run `claude` or any other commands in the isolated worktree.
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

- **Create from scratch** — New branch from any base branch
- **Cmd+N shortcut** — Opens the New Session dialog from anywhere in the app
- **Auto-focus the new agent** — Once the session is created, the agent terminal grabs focus so you can start typing immediately
- **Import existing worktree** — Bring in worktrees created outside CodeCrucible
- **Open remote branch** — Create a session from a remote branch with autocomplete
- **Open as main branch** — Temporarily check out a session's branch on the main repo (useful for builds that need the real repo path)

</details>

<details>
<summary><strong>Session startup prompts</strong></summary>

Configure per-project prompts that can be optionally auto-run in a new session's agent terminal. Pick one when creating a session — it's typed into the agent as soon as Claude is ready.

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

Every session gets an embedded terminal (xterm.js + node-pty) that opens in the worktree directory.

- **Auto-spawn** — A Claude terminal spawns automatically when you select a session
- **Dynamic terminals** — Add extra shell or Claude terminals from the workspace tab bar
- **Theme sync** — Terminal colors update when you change the app theme
- **Claude Code theme** — Separately configurable light/dark theme for the Claude Code CLI
- **Intervention detection** — Terminal output is scanned for permission prompts and questions, triggering notifications

</details>

<details>
<summary><strong>Git integration</strong></summary>

Built-in git panel with commit history, changed files, and diff viewer.

- **Commit log** — Scrollable list with polling for new commits
- **Changed files** — Both committed and working-tree changes, with right-click stage / unstage / stash / discard / reveal in Finder
- **Syntax-highlighted diffs** — Inline diff viewer powered by Shiki with full language support
- **Expand context & per-hunk collapse** — Same diff viewer powers PR review and the git tab; expand surrounding lines or fold whole hunks
- **Commit status indicators** — Unpushed commits and new branches are marked
- **Push & PR** — Push button, open PR button, and merge controls with conflict detection
- **Working file diffs** — View uncommitted changes alongside commit diffs

</details>

<details>
<summary><strong>PR review</strong></summary>

Full pull request review without leaving the IDE — comparable to GitHub's web UI for the day-to-day review loop.

- **Conversation tab** — PR description, timeline, and CI checks with markdown rendering
- **Reviewers** — Approved / Changes requested / Awaiting review groupings, plus a typeahead "Request review" picker
- **Header summary** — At-a-glance "X approved · Y changes requested · Z pending" pill in the toolbar
- **Commits tab** — Per-commit diffs with prev/next navigation
- **File tree** — Changed files with viewed-file tracking and unresolved-comment badges
- **Scrollable diff view** — Lazy-loaded per file, optimised for very large PRs
- **Expand context** — GitHub-style ↑20 / ↓20 / ⇕all buttons between hunks pull surrounding lines from the head SHA
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
<summary><strong>Claude Web sessions</strong></summary>

If you also drive Claude Code from [claude.ai/code](https://claude.com/product/claude-code), this surfaces **your** active web sessions in the sidebar so you can pull them down locally without scrolling through every `claude/*` branch in the repo.

- **Per-project, off by default** — Settings → Claude Web Sessions has an Enable toggle and a Branch prefix (defaults to `claude/`). Nothing renders until you opt in
- **Only your branches** — `claude/*` branches whose latest commit was authored by you. Identity matches against `git config user.email` *or* the GitHub noreply pattern (`<id>+<login>@users.noreply.github.com`) using your `gh` login
- **Hides finished work** — Branches whose PR is merged are excluded automatically; only branches with no PR, an open PR, or a draft PR show up
- **Click to open** — Tap a card to fetch + create the worktree. If the branch is already checked out in the main repo, the conflicting worktree is auto-detached so the new worktree can claim it
- **Stays under Claude Web** — Once opened, the session keeps living under the Claude Web section (not the Sessions list) so the two contexts stay separate
- **Polls every 30 seconds** — Piggy-backs on the existing PR poll; new commits and new sessions appear within ~30 s

![Claude Web sidebar section](docs/screenshots/claude-web-sidebar.png)
![Claude Web project settings](docs/screenshots/claude-web-settings.png)
![Claude Web session card](docs/screenshots/claude-web-card.png)

</details>

<details>
<summary><strong>Notifications & intervention detection</strong></summary>

Detects when Claude Code needs user input by scanning terminal output for permission prompts and questions.

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

Automate the review → triage → fix cycle on a branch. Each round runs three phases against the branch's diff vs. its base:

1. **Review** — A fresh Claude reviews the diff and writes structured findings to `.crucible/review-loop/round-N-issues.json`.
2. **Triage** — Another Claude reads those findings and fans out a sub-agent per issue. Each sub-agent decides `fix` / `skip` / `defer` / `noop` and writes a short justification.
3. **Fix** — Claude applies the fixes, commits, and pushes.

The loop stops on the first of: N consecutive clean rounds (default 2), iteration cap (default 5), cost cap (default $5), or manual cancel. Workspace defaults and per-project overrides for all four live in **Settings → Review Loop**, including a per-project toggle that hides the toolbar button and prevents the loop from running for that scope.

Skipped or deferred items get summarised in a single sticky comment on the open PR (using a hidden marker so subsequent rounds update the same comment instead of re-posting). That gives reviewers a record of what was knowingly left undone and why.

The Review Loop tab in the session workspace shows live progress: status pill, current phase, cumulative cost, per-round triage decisions, and a per-round log.

<table>
<tr>
<td><img src="docs/screenshots/review-loop-running.png" alt="Review Loop tab while a loop is mid-triage" /></td>
<td><img src="docs/screenshots/review-loop-completed.png" alt="Review Loop tab after the loop converged" /></td>
</tr>
<tr>
<td colspan="2"><img src="docs/screenshots/review-loop-settings.png" alt="Workspace defaults and per-project overrides for the review loop" /></td>
</tr>
</table>

</details>

<details>
<summary><strong>Permissions sync</strong></summary>

View and edit Claude Code permissions (allow/deny lists) from the right panel.

- Changes sync across all worktrees for the project
- See which tools and commands are allowed or denied at a glance

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
│   │   ├── terminal/     # Terminal (TerminalPanel, DynamicTerminalPanel)
│   │   ├── editor/       # Code editor (CodeEditorPanel, FileExplorer)
│   │   ├── buttons/      # Custom buttons (CustomButtonBar, ButtonRenderer, IconPicker)
│   │   ├── pullrequests/ # PR review (PRReviewPanel, PRConversationTab, FileTree)
│   │   ├── notes/        # Notes panel
│   │   ├── usage/        # Usage tracking panel
│   │   └── permissions/  # Permissions panel
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

# CodeCrucible

An IDE for agentic development. Manage multiple Claude Code sessions in parallel, each running in its own git worktree, with a built-in diff viewer and terminal.

![CodeCrucible](screenshot.png)

## Features

- **Multiple projects** — Open any git repository as a project. Switch between them with tabs.
- **Sessions** — Each session creates a git worktree with its own branch. Run independent Claude Code agents side by side without conflicts.
- **Embedded terminal** — Full terminal (xterm.js) opens in the session's worktree directory. Launch Claude Code and work directly.
- **Intervention notifications** — Desktop notifications when Claude Code needs your input (permission prompts, y/n questions).
- **Git diff viewer** — Browse commits, see changed files, and view inline diffs — like GitHub Desktop, built into the IDE.
- **Keyboard navigable** — Full keyboard support throughout: arrow keys for lists and tabs, Escape to close dialogs, focus trapping in modals.
- **Themeable** — Dark (Tokyo Night), Light, and Ultra Dark themes. Add your own with a single CSS block.

## Getting Started

```bash
npm install
npm run dev
```

1. Click **Add Project** and select a folder containing a git repository.
2. Create a session from the sidebar — this creates a new branch and worktree.
3. Use the terminal to run `claude` or any other commands in the isolated worktree.
4. View commits and diffs in the git panel as your agent works.

## Tech Stack

- Electron + React 19 + TypeScript
- electron-vite for builds
- Tailwind CSS 4 with CSS custom property theming
- Zustand for state management
- xterm.js + node-pty for the terminal
- simple-git for git operations

## License

MIT

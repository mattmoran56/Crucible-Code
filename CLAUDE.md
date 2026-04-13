# CodeCrucible

IDE for agentic development — manage multiple Claude Code sessions across git worktrees.

## Tech Stack

- **Runtime**: Electron 33 (main + renderer processes)
- **Renderer**: React 19, TypeScript
- **Build**: electron-vite 5, Vite 8
- **Styling**: Tailwind CSS 4 with CSS custom property theming
- **State**: Zustand (4 stores: project, session, terminal, git)
- **Terminal**: xterm.js + node-pty
- **Git**: simple-git

## Commands

```bash
npm run dev      # Start dev server with HMR
npm run build    # Production build
npm run preview  # Preview production build
```

## Architecture

Three-layer Electron architecture with strict isolation:

```
src/
├── main/            # Electron main process (Node.js)
│   ├── index.ts     # App entry, window creation
│   ├── ipc/         # IPC handler registration (one file per domain)
│   └── services/    # Business logic (git, worktree, terminal, notification)
├── preload/         # contextBridge — typed API exposed as window.api
│   └── index.ts     # Single file: all IPC invoke/on wrappers
├── renderer/        # React UI (no Node.js access)
│   ├── components/  # See Component Architecture below
│   ├── hooks/       # Shared hooks (useFocusTrap, useRovingIndex)
│   ├── stores/      # Zustand stores (projectStore, sessionStore, terminalStore, gitStore)
│   ├── styles/      # globals.css (theme definitions + Tailwind)
│   └── types/       # TypeScript declarations (api.d.ts)
└── shared/          # Code shared between main + renderer
    ├── constants.ts # IPC channel names (single source of truth)
    ├── types.ts     # DTOs passed over IPC (Project, Session, Commit, FileDiff)
    └── patterns.ts  # Regex patterns for Claude Code intervention detection
```

### IPC Rules

- All IPC channels are defined in `src/shared/constants.ts`
- Renderer communicates only via `window.api.*` (exposed by preload)
- `contextIsolation: true`, `nodeIntegration: false`
- Main process handlers live in `src/main/ipc/`, one file per domain
- `src/main/ipc/register.ts` wires them all up

### Git Worktrees

Sessions create worktrees at `<repo-parent>/.codecrucible-worktrees/<repo-name>/<session-name>/`.
Each session gets its own branch (`session/<name>`) and directory.

## Component Architecture

Components are organized in two tiers:

### Base components (`components/ui/`)

Low-level building blocks. Keyboard-navigable and accessible by default.
Every interactive element in the app should use these — never raw `<button>`, `<input>`, or custom modal markup.

| Component | Purpose | Key a11y |
|-----------|---------|----------|
| `Button` | Standard button (primary/ghost/danger) | `aria-disabled`, `aria-busy`, focus-visible ring |
| `IconButton` | Icon-only button | `aria-label` (required), focus-visible ring |
| `Dialog` | Modal with backdrop | Focus trap, Escape to close, `aria-modal`, `aria-labelledby` |
| `Input` | Labelled text input | `<label>` linked via `htmlFor`, `aria-invalid`, `aria-describedby` |
| `TabBar` / `Tab` | Horizontal tab navigation | `role="tablist"/"tab"`, roving tabindex (Arrow L/R) |
| `ListBox` / `ListItem` | Vertical selectable list | `role="listbox"/"option"`, roving tabindex (Arrow U/D) |
| `Sidebar` / `SidebarSection` | Sidebar layout container | `<aside>` landmark, `<h2>` section headers |
| `ResizeHandle` | Draggable divider between panels | `role="separator"`, focusable |
| `ToggleGroup` | Segmented control (radio group) | `role="radiogroup"/"radio"`, inline style sizing |
| `ToastContainer` | Toast notifications (mounted in App root) | Auto-dismiss, closeable |

All base components are exported from `components/ui/index.ts`.

### Compound components (feature directories)

Built from base components. Each directory corresponds to a feature area:

- `components/layout/` — App shell: `ProjectTabs`, `SessionSidebar`
- `components/sessions/` — Session management: `SessionCard`, `CreateSessionDialog`
- `components/git/` — Git viewer: `CommitList`, `ChangedFiles`, `DiffViewer`, `GitPanel`
- `components/terminal/` — Terminal: `TerminalPanel`, `useTerminal` hook

### Rules

- **Always use base components** — Don't inline raw `<button>`, `<div onClick>`, or modal markup. Use `Button`, `IconButton`, `Dialog`, `ListBox`, etc.
- **Keyboard navigation is mandatory** — Every interactive element must be reachable and operable via keyboard. The base components handle this.
- **Focus-visible, not focus** — Use `focus-visible:ring-*` so mouse users don't see focus rings.

### Error handling — Toasts

All user-facing errors must be shown as toasts using `useToastStore`:

```ts
import { useToastStore } from '../../stores/toastStore'
const { addToast } = useToastStore.getState()
addToast('error', error.message)
```

- **Show raw errors** — This is a developer tool. Always show the actual error message (e.g. `err.message`), never sanitise or wrap in generic messages.
- Toast types: `'error'` | `'success'` | `'info'`
- Toasts auto-dismiss after 5 seconds and are closeable
- `ToastContainer` is mounted once in `App.tsx` — never mount it elsewhere

## Theming

Themes are defined as CSS custom properties in `src/renderer/styles/globals.css`.

Three themes are available: `dark` (Tokyo Night, default), `light`, `ultra-dark`.
Switch by setting `data-theme` on the `<html>` element.

All Tailwind color utilities (`bg-bg`, `text-accent`, `border-border`, etc.) reference
these CSS custom properties via the `@theme` block, so they automatically respond to
theme changes.

To add a new theme: add a `[data-theme="your-theme"]` block with the same property names.

### Color tokens

| Token | Usage |
|-------|-------|
| `bg` | Primary background |
| `bg-secondary` | Sidebar, panels |
| `bg-tertiary` | Headers, subtle backgrounds |
| `border` | All borders |
| `text` | Primary text |
| `text-muted` | Secondary/placeholder text |
| `accent` | Interactive elements, links, selection |
| `accent-hover` | Hover state for accent |
| `success` | Added files, positive indicators |
| `danger` | Deleted files, destructive actions |
| `warning` | Modified files, caution |

## README & Screenshots

When implementing big features (or a set of smaller changes that together form a notable feature), update the README:

1. Add the feature to the **Feature highlights** bullet list if it's user-facing
2. Add a collapsible `<details>` block under **Features (detailed)** with specifics
3. Update the **Architecture** section if new directories/stores were added
4. **Capture new screenshots** using the `/update-screenshots` skill — this runs Storybook + Playwright to generate PNGs. Review the screenshots yourself and iterate until they look good before committing.

### Storybook & Screenshots

- **Storybook**: `npm run storybook` — renders components with mock data via `mock/mockApi.ts`
- **Screenshots**: `npm run screenshots` — Playwright captures from running Storybook to `docs/screenshots/`
- **Mock data**: `mock/mockData.ts` — update when adding new features that need mock state
- **Store setup**: `src/renderer/stories/helpers/storeSetup.ts` — pre-populates Zustand stores for stories
- **Stories**: Co-located `.stories.tsx` files next to components. Full app stories in `src/renderer/stories/FullApp.stories.tsx`
- Add new stories for new components. For compound components, use `setupStoresForStory()` decorator.

## Layout Principles

- **All panels are resizable** — Every block/panel in the IDE should be resizable by dragging its edge. Use `ResizeHandle` + `useResizable` hook for this. The sidebar, terminal, commit list, changed files columns are all resizable.
- Compact UI with modest padding (8-12px internal, 10-12px section headers)
- Flush/edge-to-edge panels — no border radius on panels, no gaps between sections
- Inline `style={{ padding: '...' }}` for reliable padding values

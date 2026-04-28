---
description: Capture and verify screenshots from Storybook for the README. Use after adding/changing features that affect the UI.
user_invocable: true
---

# Update Screenshots

Capture screenshots from Storybook stories using Playwright and verify they look correct.

## Prerequisites

Storybook must be running. If not already running, start it:

```bash
npm run storybook
```

Wait for it to be ready on http://localhost:6006.

## Steps

### 1. Update mock data if needed

If you've added new features, update the mock data so Storybook stories show them:

- **`mock/mockData.ts`** — Add mock entities (projects, sessions, commits, PRs, etc.)
- **`mock/mockApi.ts`** — Add mock API methods if new IPC channels were added
- **`src/renderer/stories/helpers/storeSetup.ts`** — Pre-populate new Zustand stores

### 2. Add or update stories

- For new components: create co-located `.stories.tsx` file next to the component
- For new full-app views: add a variant to `src/renderer/stories/FullApp.stories.tsx`
- Use `setupStoresForStory()` decorator for compound components that need Zustand state

### 3. Update screenshot targets

If you need new screenshots, edit `scripts/capture-screenshots.ts`:
- Add entries to the `targets` array with the story ID and desired filename
- Story IDs are lowercase-hyphenated: `title: 'App/Full Layout'` → `app-full-layout--story-name`

### 4. Capture screenshots

```bash
npm run screenshots
```

This runs Playwright headless against the running Storybook and saves PNGs to `docs/screenshots/`.

### 5. Review screenshots

**You must review the screenshots yourself before committing.** Read each PNG file and check:

- The correct view/panel is showing (not just the default agent view)
- Terminal content is visible with correct theme colors
- Theme screenshots have matching terminal backgrounds
- Session sidebar shows status indicators (spinner, dot, checkmark)
- No error messages or broken layouts
- Text is readable and not clipped

If any screenshot looks wrong:
1. Check the story renders correctly in the browser at http://localhost:6006
2. Adjust store setup, mock data, or delays in the capture script
3. Re-run `npm run screenshots` and review again

### 6. Update README if needed

Ensure `README.md` image paths match the filenames in `docs/screenshots/`. The format is:

```markdown
![Alt text](docs/screenshots/filename.png)
```

### 7. Commit

Stage the updated screenshots and any changed files, then commit.

## Architecture

- **Storybook config**: `.storybook/main.ts` and `.storybook/preview.ts`
- **Mock API**: `mock/mockApi.ts` — complete `window.api` mock so components work outside Electron
- **Mock data**: `mock/mockData.ts` — typed seed data for all entities
- **Store setup**: `src/renderer/stories/helpers/storeSetup.ts` — Zustand store pre-population
- **Screenshot script**: `scripts/capture-screenshots.ts` — Playwright-based capture
- **Theme sync**: `preview.ts` exposes `window.__setTheme()` so the capture script can sync terminal theme colors

## Key insight

The Storybook setup mocks `window.api` globally in `preview.ts` before any stores initialize. This means **all Zustand stores work exactly as they do in the real Electron app** — zero production code changes needed. For stories of compound components, use `setupStoresForStory()` to inject mock data into stores before render.

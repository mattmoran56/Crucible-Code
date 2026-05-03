# Tests

Three suites, each runnable independently:

| Suite        | Tool                   | Command                        | Purpose                                            |
| ------------ | ---------------------- | ------------------------------ | -------------------------------------------------- |
| Unit         | Vitest + RTL           | `npm run test:unit`            | Pure logic, hooks, stores, components              |
| Coverage     | Vitest + V8            | `npm run test:coverage`        | Same suite, with `coverage/` HTML + text summary   |
| Screenshots  | Playwright + Storybook | `npm run test:screenshots`     | Visual regressions on isolated stories             |
| E2E          | Playwright + mock app  | `npm run test:e2e`             | Boot path and core flows against the mock backend  |

`npm test` is an alias for `npm run test:unit`.
`npm run test:all` runs everything in sequence.

## What's covered

Roughly:

- **Unit tests (~400 tests)** — every store, every hook, every UI primitive,
  and a representative slice of feature components (PR card, suggestion block,
  CI indicator, label chip, session card).
- **Screenshot tests (~55 baselines)** — every Storybook story is captured at
  a tuned viewport, plus a representative full-app shot in each of the four
  themes (Tokyo Night, Light, Soft Light, Ultra Dark).
- **E2E tests (~25 tests)** — project tabs, session sidebar, settings page,
  right activity-bar panels, and a boot-health check, all against the mock
  Vite app.

What's intentionally **not** covered yet (each is non-trivial to test in
isolation): the terminal store and its xterm bindings, `useDiffHighlighting`
(shiki async loader), the editor file-explorer, and the larger PR review
panel (`PRReviewPanel.tsx`, `PRConversationTab.tsx`). These run through the
e2e + screenshot suites instead.

## Updating screenshot baselines

After an intentional UI change, regenerate the baselines:

```sh
npm run test:screenshots:update
```

Then commit the new files in `tests/screenshots/storybook.spec.ts-snapshots/`.

## CI

GitHub Actions runs all three suites on every push to `main` and every PR
(`.github/workflows/tests.yml`). Three parallel jobs:

- **Unit / component** — `npm run test:coverage`, uploads the HTML coverage
  report as an artifact.
- **E2E (mock app)** — `npm run test:e2e`, uploads Playwright traces on
  failure.
- **Visual regression** — `npm run test:screenshots`, uploads the diff PNGs
  on failure so a reviewer can eyeball what changed.

Playwright browsers are cached in `~/.cache/ms-playwright` keyed on
`package-lock.json` to keep runs fast.

### Screenshot baseline platform pinning

Baselines are generated with the chromium that ships with the installed
Playwright version. If CI fails on screenshots after a Playwright bump (or
when first wiring CI up against an existing baseline set), download the
`screenshot-diffs` artifact, sanity-check the visual differences, then
regenerate locally and commit:

```sh
npm run test:screenshots:update
```

## Sandbox / local notes

The Playwright config will use `/opt/pw-browsers/chromium` if it exists
(matches our local sandbox image). Override with `PLAYWRIGHT_CHROMIUM_PATH`
or disable with `PLAYWRIGHT_CHROMIUM_DISABLE=1`. Otherwise Playwright falls
back to its bundled browser (`npx playwright install chromium`).

The Playwright `webServer` block boots Storybook (port 6006) and the mock
Vite server (port 5199) automatically.

## Memory / OOM

Vitest runs each file in a fresh fork (`pool: 'forks'`,
`fileParallelism: false`). React + jsdom together leak DOM nodes across
files; isolating per-file has no cumulative growth. If you ever hit OOM
locally, raise the heap with:

```sh
NODE_OPTIONS=--max-old-space-size=4096 npm run test:unit
```

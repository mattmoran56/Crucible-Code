# Tests

Three suites, each runnable independently:

| Suite        | Tool                | Command               | Purpose                                    |
| ------------ | ------------------- | --------------------- | ------------------------------------------ |
| Unit         | Vitest + RTL        | `npm run test:unit`        | Pure logic, hooks, stores, small components |
| Screenshots  | Playwright + Storybook | `npm run test:screenshots` | Visual regressions on isolated stories     |
| E2E          | Playwright + mock app  | `npm run test:e2e`         | Boot path and core flows against the mock backend |

`npm test` is an alias for `npm run test:unit`.
`npm run test:all` runs everything in sequence.

## Updating screenshot baselines

After an intentional UI change, regenerate the baselines:

```sh
npm run test:screenshots:update
```

Then commit the new files in `tests/screenshots/storybook.spec.ts-snapshots/`.

## CI / sandbox notes

The Playwright config will use `/opt/pw-browsers/chromium` if it exists
(matches our sandbox image). Override with `PLAYWRIGHT_CHROMIUM_PATH` or
disable with `PLAYWRIGHT_CHROMIUM_DISABLE=1`. Otherwise Playwright falls back
to its bundled browser (run `npx playwright install chromium` first).

The Playwright `webServer` block boots Storybook (port 6006) and the mock
Vite server (port 5199) automatically.

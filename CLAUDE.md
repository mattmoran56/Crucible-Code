## Pull request requirements

- All front-end PRs must include screenshots (or a short screen recording) in the PR description showing the change working. If the PR touches UI — layouts, components, styles, or visual behavior — this is required, not optional.
- Screenshots in PR descriptions must use **absolute raw URLs** (e.g. `https://github.com/<owner>/<repo>/raw/<branch>/docs/screenshots/foo.png`). Relative paths like `docs/screenshots/foo.png` work in `README.md` but do not render reliably in PR or issue descriptions.

## Claude session permissions

- Never run Claude in bypass-permissions mode. Do not pass `--dangerously-skip-permissions`, and do not map a permission mode to it. The app deliberately never forces it.
- Sessions — and any automated/foreground phase we spawn (e.g. the review loop, foundry workers) — run in **auto mode**. We get this by passing **no** `--permission-mode` at all, so the CLI inherits the user's configured default (`auto`). Do **not** pass `--permission-mode acceptEdits`: recent Claude Code makes `auto` and `acceptEdits` distinct modes, and forcing `acceptEdits` drops sessions out of the broader auto mode. Auto runs hands-off while still prompting for anything riskier than an edit; the user can always step into the terminal. The single source of truth is `AUTO_PERMISSION_MODE_ARGS` in `terminal.service.ts`, which is the empty array — keep it that way (never add `acceptEdits`/`bypassPermissions`).

## Documentation

- Keep `README.md` up to date with user-visible changes. If a PR adds, removes, or meaningfully changes a feature listed there (or one that *should* be listed), update the matching section as part of the same PR. The feature sections under `<details>` blocks are the source of truth for what the app does — they should not drift behind the code.

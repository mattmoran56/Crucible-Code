## Pull request requirements

- All front-end PRs must include screenshots (or a short screen recording) in the PR description showing the change working. If the PR touches UI — layouts, components, styles, or visual behavior — this is required, not optional.
- Screenshots in PR descriptions must use **absolute raw URLs** (e.g. `https://github.com/<owner>/<repo>/raw/<branch>/docs/screenshots/foo.png`). Relative paths like `docs/screenshots/foo.png` work in `README.md` but do not render reliably in PR or issue descriptions.

## Documentation

- Keep `README.md` up to date with user-visible changes. If a PR adds, removes, or meaningfully changes a feature listed there (or one that *should* be listed), update the matching section as part of the same PR. The feature sections under `<details>` blocks are the source of truth for what the app does — they should not drift behind the code.

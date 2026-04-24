# Contributing to CodeCrucible

Thanks for your interest in contributing! CodeCrucible is built with AI agents, and contributions follow a prompt-first workflow.

## Getting set up

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Start the dev server: `npm run dev`
4. Create a branch from `main`

## Pull requests

**Describe the intent, not the diff.**

When you open a PR, the most important thing is explaining *what you were trying to achieve* — the prompt, the goal, the problem you're solving. The code diff speaks for itself; the description should answer:

- **What problem does this solve?** Or what feature does this add?
- **What was the intent / prompt that drove the change?** What did you ask for, and why?
- **Any design decisions the reviewer should know about?**

Features are accepted or rejected based on whether the *aim* fits the project direction, so make the aim clear. A well-explained intent with rough code is more useful than polished code with no context.

**Include screenshots for all front-end changes.** If your PR touches UI — layouts, components, styles, or visual behavior — attach before/after screenshots (or a short screen recording) in the PR description. This proves the change works as intended and makes review faster. PRs that modify the UI without visual evidence will be sent back.

## Code style

- TypeScript throughout — no `any` where a type can be inferred or defined
- Use the base UI components from `src/renderer/components/ui/` — never raw `<button>`, `<input>`, or custom modal markup
- Keyboard navigation is mandatory for all interactive elements
- User-facing errors go through `useToastStore` — show the raw error message, never sanitise it
- IPC channels are defined in `src/shared/constants.ts` — add new channels there

## Reporting issues

Open a GitHub issue. Include steps to reproduce and the error message or a screenshot.

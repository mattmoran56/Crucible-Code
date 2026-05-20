import { test, expect, type Page } from '@playwright/test'

/**
 * Visual-regression suite. Each entry below renders one Storybook story at a
 * given viewport (and optionally with a global theme override) and asserts the
 * screenshot matches the committed baseline. Update baselines after an
 * intentional UI change with:
 *
 *   npm run test:screenshots:update
 */

interface Target {
  name: string
  storyId: string
  /** Extra wait for stories with terminals / async content. */
  delay?: number
  viewport?: { width: number; height: number }
  /** Storybook globals (e.g. theme:Light) to apply. */
  globals?: string
}

const THEMES: { key: string; label: string }[] = [
  { key: 'dark', label: 'Dark (Tokyo Night)' },
  { key: 'light', label: 'Light' },
  { key: 'soft-light', label: 'Soft Light' },
  { key: 'ultra-dark', label: 'Ultra Dark' },
]

function buttonTargets(): Target[] {
  const stories = [
    { name: 'button-primary', storyId: 'ui-button--primary' },
    { name: 'button-ghost', storyId: 'ui-button--ghost' },
    { name: 'button-danger', storyId: 'ui-button--danger' },
    { name: 'button-loading', storyId: 'ui-button--loading' },
    { name: 'button-small', storyId: 'ui-button--small' },
    { name: 'button-disabled', storyId: 'ui-button--disabled' },
  ]
  return stories.map((s) => ({ ...s, viewport: { width: 320, height: 120 } }))
}

function inputTargets(): Target[] {
  return [
    { name: 'input-default', storyId: 'ui-input--default', viewport: { width: 360, height: 120 } },
    { name: 'input-with-hint', storyId: 'ui-input--with-hint', viewport: { width: 360, height: 140 } },
    { name: 'input-with-error', storyId: 'ui-input--with-error', viewport: { width: 360, height: 140 } },
  ]
}

function dialogTargets(): Target[] {
  return [
    { name: 'dialog-default', storyId: 'ui-dialog--default', viewport: { width: 480, height: 360 }, delay: 200 },
    { name: 'dialog-confirmation', storyId: 'ui-dialog--confirmation', viewport: { width: 480, height: 360 }, delay: 200 },
  ]
}

function listBoxTargets(): Target[] {
  return [
    { name: 'listbox-default', storyId: 'ui-listbox--default', viewport: { width: 360, height: 240 } },
  ]
}

function tabBarTargets(): Target[] {
  return [
    { name: 'tabbar-default', storyId: 'ui-tabbar--default', viewport: { width: 480, height: 80 } },
  ]
}

function contextMenuTargets(): Target[] {
  // The ContextMenu stories require a right-click to open the menu — they
  // render the closed-state target as the default snapshot. We assert on the
  // menu-open variants in the e2e suite via the right-click flow.
  return [
    { name: 'contextmenu-file-explorer-closed', storyId: 'ui-contextmenu--file-explorer', viewport: { width: 480, height: 240 }, delay: 200 },
    { name: 'contextmenu-changed-files-closed', storyId: 'ui-contextmenu--changed-files', viewport: { width: 480, height: 240 }, delay: 200 },
  ]
}

function prCardTargets(): Target[] {
  const v = { width: 320, height: 240 }
  return [
    { name: 'pr-card-default', storyId: 'pr-prcard--default', viewport: v },
    { name: 'pr-card-labels-on', storyId: 'pr-prcard--labels-on', viewport: v },
    { name: 'pr-card-only-two-labels', storyId: 'pr-prcard--only-two-labels', viewport: v },
    { name: 'pr-card-all-fields-on', storyId: 'pr-prcard--all-fields-on', viewport: { width: 320, height: 360 } },
    { name: 'pr-card-draft', storyId: 'pr-prcard--draft', viewport: v },
  ]
}

function reviewersTargets(): Target[] {
  return [
    { name: 'pr-reviewers-empty', storyId: 'pr-reviewerssection--empty', viewport: { width: 540, height: 200 }, delay: 200 },
    { name: 'pr-reviewers-mixed', storyId: 'pr-reviewerssection--mixed-states', viewport: { width: 540, height: 360 }, delay: 200 },
    { name: 'pr-reviewers-approvals-only', storyId: 'pr-reviewerssection--approvals-only', viewport: { width: 540, height: 280 }, delay: 200 },
    { name: 'pr-reviewers-pending-only', storyId: 'pr-reviewerssection--pending-only', viewport: { width: 540, height: 240 }, delay: 200 },
  ]
}

function suggestionTargets(): Target[] {
  return [
    { name: 'pr-suggestion-singleline', storyId: 'pr-suggestionblock--single-line', viewport: { width: 600, height: 200 }, delay: 200 },
    { name: 'pr-suggestion-multiline', storyId: 'pr-suggestionblock--multi-line', viewport: { width: 600, height: 260 }, delay: 200 },
    { name: 'pr-suggestion-disabled', storyId: 'pr-suggestionblock--branch-not-checked-out', viewport: { width: 600, height: 200 }, delay: 200 },
  ]
}

function inlineThreadTargets(): Target[] {
  return [
    { name: 'pr-inlinethread-open', storyId: 'pr-inlinethread--open', viewport: { width: 720, height: 400 }, delay: 200 },
    { name: 'pr-inlinethread-resolved', storyId: 'pr-inlinethread--resolved', viewport: { width: 720, height: 200 }, delay: 200 },
    { name: 'pr-inlinethread-suggestion', storyId: 'pr-inlinethread--with-suggestion', viewport: { width: 720, height: 380 }, delay: 200 },
  ]
}

function prSortFilterTargets(): Target[] {
  return [
    { name: 'pr-sort-filter-open', storyId: 'pr-prsortfiltermenu--open', viewport: { width: 360, height: 540 }, delay: 200 },
    { name: 'pr-sort-filter-active', storyId: 'pr-prsortfiltermenu--filters-active', viewport: { width: 360, height: 580 }, delay: 200 },
    { name: 'pr-sort-filter-people', storyId: 'pr-prsortfiltermenu--person-picker', viewport: { width: 360, height: 460 }, delay: 200 },
  ]
}

function sessionCardTargets(): Target[] {
  const v = { width: 280, height: 100 }
  return [
    { name: 'session-card-default', storyId: 'sessions-sessioncard--default', viewport: v },
    { name: 'session-card-active', storyId: 'sessions-sessioncard--active', viewport: v },
    { name: 'session-card-running', storyId: 'sessions-sessioncard--running', viewport: v },
    { name: 'session-card-attention', storyId: 'sessions-sessioncard--attention', viewport: v },
    { name: 'session-card-completed', storyId: 'sessions-sessioncard--completed', viewport: v },
    { name: 'session-card-with-pr', storyId: 'sessions-sessioncard--with-pr', viewport: { width: 280, height: 130 } },
    { name: 'session-card-with-draft-pr', storyId: 'sessions-sessioncard--with-draft-pr', viewport: { width: 280, height: 130 } },
    { name: 'session-card-with-merged-pr', storyId: 'sessions-sessioncard--with-merged-pr', viewport: { width: 280, height: 130 } },
  ]
}

function sessionSidebarTargets(): Target[] {
  return [
    { name: 'session-sidebar-default', storyId: 'layout-sessionsidebar--default', viewport: { width: 300, height: 600 }, delay: 600 },
  ]
}

function settingsTargets(): Target[] {
  return [
    { name: 'pr-list-display-empty', storyId: 'settings-prlistdisplaysettings--empty', viewport: { width: 720, height: 600 }, delay: 200 },
    { name: 'pr-list-display-customized', storyId: 'settings-prlistdisplaysettings--one-customized', viewport: { width: 720, height: 600 }, delay: 200 },
    { name: 'pr-list-display-label-picker', storyId: 'settings-prlistdisplaysettings--label-picker-open', viewport: { width: 720, height: 700 }, delay: 200 },
    { name: 'notion-settings-empty', storyId: 'settings-notionintegrationsettings--empty', viewport: { width: 800, height: 540 }, delay: 300 },
    { name: 'notion-settings-configured', storyId: 'settings-notionintegrationsettings--configured', viewport: { width: 800, height: 1400 }, delay: 600 },
    { name: 'notion-settings-mcp-prompt', storyId: 'settings-notionintegrationsettings--mcp-prompt-open', viewport: { width: 800, height: 1500 }, delay: 700 },
  ]
}

function gitPanelTargets(): Target[] {
  return [
    { name: 'git-panel-default', storyId: 'git-gitpanel--default', viewport: { width: 1200, height: 700 }, delay: 600 },
  ]
}

function fullAppTargets(): Target[] {
  // The big-picture app screenshots — these are slow because they spin up an
  // xterm and many panels, so we keep delays generous.
  return [
    { name: 'app-default', storyId: 'app-full-layout--default', viewport: { width: 1280, height: 800 }, delay: 2000 },
    { name: 'app-git-view', storyId: 'app-full-layout--git-view', viewport: { width: 1280, height: 800 }, delay: 1800 },
    { name: 'app-pr-review', storyId: 'app-full-layout--pr-review', viewport: { width: 1280, height: 800 }, delay: 1800 },
    { name: 'app-editor', storyId: 'app-full-layout--editor-view', viewport: { width: 1280, height: 800 }, delay: 1800 },
    { name: 'app-settings', storyId: 'app-full-layout--settings', viewport: { width: 1280, height: 800 }, delay: 1000 },
    { name: 'app-new-session-dialog', storyId: 'app-full-layout--new-session-dialog', viewport: { width: 1280, height: 800 }, delay: 1500 },
  ]
}

const COMPONENT_TARGETS: Target[] = [
  ...buttonTargets(),
  ...inputTargets(),
  ...dialogTargets(),
  ...listBoxTargets(),
  ...tabBarTargets(),
  ...contextMenuTargets(),
  ...prCardTargets(),
  ...reviewersTargets(),
  ...suggestionTargets(),
  ...inlineThreadTargets(),
  ...prSortFilterTargets(),
  ...sessionCardTargets(),
  ...sessionSidebarTargets(),
  ...settingsTargets(),
  ...gitPanelTargets(),
]

const FULL_APP_TARGETS = fullAppTargets()

async function gotoStory(page: Page, storyId: string, globals?: string) {
  const url = `/iframe.html?id=${storyId}&viewMode=story${globals ? `&globals=${encodeURIComponent(globals)}` : ''}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // Storybook injects the story asynchronously. Most stories render into
  // #storybook-root; portal-based ones (Dialog, ContextMenu) attach directly
  // to <body>, so we accept either a non-empty story root OR any rendered
  // story content (role=dialog / role=menu).
  await page.waitForFunction(() => {
    const root = document.querySelector('#storybook-root')
    if (root && root.children.length > 0) return true
    return !!document.querySelector('[role="dialog"], [role="menu"]')
  }, { timeout: 10_000 })
}

async function snapshot(page: Page, t: Target) {
  if (t.viewport) await page.setViewportSize(t.viewport)
  await gotoStory(page, t.storyId, t.globals)
  if (t.delay) await page.waitForTimeout(t.delay)
  // Stabilize: hide caret, wait for fonts
  await page.addStyleTag({
    content: `*, *::before, *::after { caret-color: transparent !important; }`,
  })
  await page.evaluate(() => document.fonts?.ready)
  await expect(page).toHaveScreenshot(`${t.name}.png`, { fullPage: false })
}

test.describe('Component snapshots', () => {
  for (const t of COMPONENT_TARGETS) {
    test(t.name, async ({ page }) => snapshot(page, t))
  }
})

test.describe('Full App snapshots', () => {
  for (const t of FULL_APP_TARGETS) {
    test(t.name, async ({ page }) => snapshot(page, t))
  }
})

// One representative full-app shot per theme — assures the theme system works
// end-to-end across the whole app, not just at the design-token level.
test.describe('Theme variants', () => {
  for (const theme of THEMES) {
    test(`app-default-theme-${theme.key}`, async ({ page }) => {
      await snapshot(page, {
        name: `app-default-theme-${theme.key}`,
        storyId: 'app-full-layout--default',
        viewport: { width: 1280, height: 800 },
        delay: 2000,
        globals: `theme:${theme.label}`,
      })
    })
  }
})

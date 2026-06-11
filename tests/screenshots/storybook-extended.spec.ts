import { test, expect, type Page } from '@playwright/test'

/**
 * Extended visual-regression suite covering the stories that the original
 * storybook.spec.ts does not snapshot: DiffViewer, PRConversationTab,
 * RemoteTogglePopover, ClaudeWebSessionCard, the remaining Full-App layout
 * states, and the remote receiver components. Baselines update with:
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
  /** Optional interaction to run before the screenshot (e.g. open a popover). */
  interact?: (page: Page) => Promise<void>
}

function diffViewerTargets(): Target[] {
  const v = { width: 1000, height: 640 }
  return [
    { name: 'diffviewer-unified', storyId: 'git-diffviewer--unified-view', viewport: v, delay: 800 },
    { name: 'diffviewer-split', storyId: 'git-diffviewer--split-view', viewport: v, delay: 800 },
    { name: 'diffviewer-unified-expanded', storyId: 'git-diffviewer--unified-with-expanded-context', viewport: v, delay: 800 },
    { name: 'diffviewer-split-expanded', storyId: 'git-diffviewer--split-with-expanded-context', viewport: v, delay: 800 },
  ]
}

function prConversationTargets(): Target[] {
  const v = { width: 760, height: 720 }
  return [
    { name: 'pr-conversation-threads', storyId: 'pr-prconversationtab--with-review-threads', viewport: v, delay: 400 },
    { name: 'pr-conversation-unresolved', storyId: 'pr-prconversationtab--only-unresolved', viewport: v, delay: 400 },
    { name: 'pr-conversation-resolved', storyId: 'pr-prconversationtab--all-resolved', viewport: v, delay: 400 },
    { name: 'pr-conversation-no-reviews', storyId: 'pr-prconversationtab--no-review-comments', viewport: v, delay: 400 },
  ]
}

/**
 * The RemoteTogglePopover stories render the closed toggle button; the
 * popover itself only mounts after a click, so we click before snapshotting
 * the open-state variants.
 */
function remotePopoverTargets(): Target[] {
  const v = { width: 460, height: 700 }
  const openToggle = async (page: Page) => {
    const toggle = page.getByTitle('Remote connection')
    await toggle.waitFor({ state: 'visible', timeout: 15_000 })
    await toggle.click()
    await page.waitForTimeout(400)
  }
  return [
    { name: 'remote-popover-closed', storyId: 'layout-remotetogglepopover--closed', viewport: { width: 460, height: 120 }, delay: 200 },
    { name: 'remote-popover-lan-only', storyId: 'layout-remotetogglepopover--open-lan-only', viewport: v, delay: 300, interact: openToggle },
    { name: 'remote-popover-cloud-connected', storyId: 'layout-remotetogglepopover--open-cloud-connected', viewport: v, delay: 300, interact: openToggle },
    { name: 'remote-popover-short-code', storyId: 'layout-remotetogglepopover--open-short-code-mode', viewport: v, delay: 300, interact: openToggle },
    { name: 'remote-popover-require-approval', storyId: 'layout-remotetogglepopover--open-require-approval-on', viewport: v, delay: 300, interact: openToggle },
  ]
}

function claudeWebCardTargets(): Target[] {
  const v = { width: 320, height: 150 }
  return [
    { name: 'claude-web-card-default', storyId: 'sessions-claudewebsessioncard--default', viewport: v },
    { name: 'claude-web-card-opening', storyId: 'sessions-claudewebsessioncard--opening', viewport: v },
    { name: 'claude-web-card-open-pr', storyId: 'sessions-claudewebsessioncard--with-open-pr', viewport: v },
    { name: 'claude-web-card-draft-pr', storyId: 'sessions-claudewebsessioncard--with-draft-pr', viewport: v },
  ]
}

function sessionCardExtraTargets(): Target[] {
  return [
    { name: 'session-card-notion-ticket', storyId: 'sessions-sessioncard--with-notion-ticket', viewport: { width: 280, height: 130 } },
  ]
}

function fullAppExtraTargets(): Target[] {
  const v = { width: 1280, height: 800 }
  return [
    { name: 'app-editor-branch-picker', storyId: 'app-full-layout--editor-branch-picker', viewport: v, delay: 1800 },
    { name: 'app-editor-worktree-view', storyId: 'app-full-layout--editor-worktree-view', viewport: v, delay: 1800 },
    { name: 'app-custom-buttons', storyId: 'app-full-layout--custom-buttons', viewport: v, delay: 1800 },
    { name: 'app-opened-as-main-branch', storyId: 'app-full-layout--opened-as-main-branch', viewport: v, delay: 1800 },
    { name: 'app-button-settings', storyId: 'app-full-layout--button-settings', viewport: v, delay: 1500 },
    { name: 'app-code-attention', storyId: 'app-full-layout--code-attention', viewport: v, delay: 1800 },
    { name: 'app-pr-attention', storyId: 'app-full-layout--pr-attention', viewport: v, delay: 1800 },
    { name: 'app-tab-attention', storyId: 'app-full-layout--tab-attention', viewport: v, delay: 1800 },
    { name: 'app-new-session-dialog-input', storyId: 'app-full-layout--new-session-dialog-with-input', viewport: v, delay: 1500 },
    { name: 'app-rename-session-dialog', storyId: 'app-full-layout--rename-session-dialog', viewport: v, delay: 1500 },
    { name: 'app-startup-prompt-settings', storyId: 'app-full-layout--startup-prompt-settings', viewport: v, delay: 1500 },
    { name: 'app-startup-prompt-editor', storyId: 'app-full-layout--startup-prompt-editor', viewport: v, delay: 1500 },
    { name: 'app-review-loop-running', storyId: 'app-full-layout--review-loop-running', viewport: v, delay: 1800 },
  ]
}

function receiverTargets(): Target[] {
  return [
    { name: 'receiver-project-tabs', storyId: 'remote-projecttabs--default', viewport: { width: 420, height: 120 }, delay: 200 },
    { name: 'receiver-project-tabs-single', storyId: 'remote-projecttabs--single-project', viewport: { width: 420, height: 120 }, delay: 200 },
    { name: 'receiver-project-tabs-empty', storyId: 'remote-projecttabs--empty', viewport: { width: 420, height: 120 }, delay: 200 },
    { name: 'receiver-mobile-nav-open', storyId: 'remote-mobilenav--open', viewport: { width: 390, height: 700 }, delay: 300 },
    { name: 'receiver-mobile-nav-closed', storyId: 'remote-mobilenav--closed', viewport: { width: 390, height: 700 }, delay: 300 },
    { name: 'receiver-sidebar-default', storyId: 'remote-sessionsidebar--default', viewport: { width: 340, height: 640 }, delay: 400 },
    { name: 'receiver-sidebar-loading', storyId: 'remote-sessionsidebar--loading', viewport: { width: 340, height: 640 }, delay: 400 },
    { name: 'receiver-sidebar-empty', storyId: 'remote-sessionsidebar--empty', viewport: { width: 340, height: 640 }, delay: 400 },
    { name: 'receiver-sidebar-settings-active', storyId: 'remote-sessionsidebar--settings-active', viewport: { width: 340, height: 640 }, delay: 400 },
    { name: 'receiver-theme-radio-list', storyId: 'remote-theme--radio-list', viewport: { width: 420, height: 480 }, delay: 300 },
    { name: 'receiver-theme-dropdown', storyId: 'remote-theme--dropdown', viewport: { width: 420, height: 320 }, delay: 300 },
    // remote-handlepage--default is omitted: the story fails to render in the
    // Storybook iframe (empty root + error display), so there is nothing
    // stable to snapshot.
  ]
}

/**
 * Theme sweeps for representative leaf components — the original suite only
 * sweeps themes at the full-app level.
 */
function themeSweepTargets(): Target[] {
  const themes: { key: string; label: string }[] = [
    { key: 'light', label: 'Light' },
    { key: 'soft-light', label: 'Soft Light' },
    { key: 'ultra-dark', label: 'Ultra Dark' },
  ]
  const subjects = [
    { name: 'button-primary', storyId: 'ui-button--primary', viewport: { width: 320, height: 120 } },
    { name: 'input-default', storyId: 'ui-input--default', viewport: { width: 360, height: 120 } },
    { name: 'pr-card-default', storyId: 'pr-prcard--default', viewport: { width: 320, height: 240 } },
    { name: 'session-card-default', storyId: 'sessions-sessioncard--default', viewport: { width: 280, height: 100 } },
    { name: 'dialog-default', storyId: 'ui-dialog--default', viewport: { width: 480, height: 360 }, delay: 200 },
  ]
  const out: Target[] = []
  for (const s of subjects) {
    for (const t of themes) {
      out.push({ ...s, name: `${s.name}-theme-${t.key}`, globals: `theme:${t.label}` })
    }
  }
  return out
}

const TARGETS: Target[] = [
  ...diffViewerTargets(),
  ...prConversationTargets(),
  ...remotePopoverTargets(),
  ...claudeWebCardTargets(),
  ...sessionCardExtraTargets(),
  ...fullAppExtraTargets(),
  ...receiverTargets(),
  ...themeSweepTargets(),
]

async function gotoStory(page: Page, storyId: string, globals?: string) {
  const url = `/iframe.html?id=${storyId}&viewMode=story${globals ? `&globals=${encodeURIComponent(globals)}` : ''}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
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
  if (t.interact) await t.interact(page)
  await page.addStyleTag({
    content: `*, *::before, *::after { caret-color: transparent !important; }`,
  })
  await page.evaluate(() => document.fonts?.ready)
  await expect(page).toHaveScreenshot(`${t.name}.png`, { fullPage: false })
}

test.describe('Extended component snapshots', () => {
  for (const t of TARGETS) {
    test(t.name, async ({ page }) => snapshot(page, t))
  }
})

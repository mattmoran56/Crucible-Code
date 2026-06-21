/**
 * Capture screenshots from running Storybook for README documentation.
 *
 * Usage:
 *   1. Start Storybook: npm run storybook
 *   2. Run this script: npx tsx scripts/capture-screenshots.ts
 *
 * Screenshots are saved to docs/screenshots/
 */

import { chromium, type Page } from 'playwright'
import path from 'path'
import fs from 'fs'

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? 'http://localhost:6006'
const OUTPUT_DIR = path.resolve(__dirname, '../docs/screenshots')
const VIEWPORT = { width: 1440, height: 900 }

interface ScreenshotTarget {
  name: string
  storyId: string
  theme?: string
  delay?: number
  viewport?: { width: number; height: number }
  /** CSS selector to scroll into view before capture */
  scrollTo?: string
  /** Click a sidebar nav button (by exact text) before capture — used for the
   * Settings page where each section is a separate panel. */
  clickNav?: string
  /** Right-click the demo container to trigger a context menu before capture. */
  rightClickDemo?: boolean
  /** Click an element matching this selector before capture. */
  clickSelector?: string
  /** Click a button whose text matches this string before capture. */
  clickButtonText?: string
}

/**
 * Apply a theme by setting data-theme AND calling the settings store
 * so the terminal theme updates too (xterm reads from the store).
 */
async function applyTheme(page: Page, theme: string) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t)
    // Also update the Zustand settings store so terminal theme syncs
    try {
      const store = (window as any).__ZUSTAND_SETTINGS_STORE__
      if (store) store.getState().setTheme(t)
    } catch {}
  }, theme)
  await page.waitForTimeout(500)
}

/**
 * Inject a hook into the page that exposes the settings store globally,
 * so we can change themes programmatically including terminal theme.
 */
async function exposeSettingsStore(page: Page) {
  await page.evaluate(() => {
    // The settings store is imported by many components. Find it via Zustand's
    // internal API. As a simpler approach, we just call setTheme which is
    // already wired to update data-theme AND terminal colors.
    const interval = setInterval(() => {
      try {
        // Try to access the store via module scope — this works because
        // Zustand stores are singletons in the module graph
        const storeModule = (window as any).__SETTINGS_STORE_REF__
        if (storeModule) clearInterval(interval)
      } catch {}
    }, 100)
    setTimeout(() => clearInterval(interval), 5000)
  })
}

const targets: ScreenshotTarget[] = [
  {
    name: 'hero',
    storyId: 'app-full-layout--default',
    delay: 3000,
  },
  {
    name: 'git-diff',
    storyId: 'app-full-layout--git-view',
    delay: 2000,
  },
  {
    name: 'pr-review',
    storyId: 'app-full-layout--pr-review',
    delay: 2000,
  },
  {
    name: 'editor',
    storyId: 'app-full-layout--editor-view',
    delay: 2000,
  },
  {
    name: 'editor-branch-picker',
    storyId: 'app-full-layout--editor-branch-picker',
    delay: 2500,
  },
  {
    name: 'editor-worktree',
    storyId: 'app-full-layout--editor-worktree-view',
    delay: 2000,
  },
  {
    name: 'settings',
    storyId: 'app-full-layout--settings',
    delay: 1000,
  },
  {
    name: 'sessions',
    storyId: 'layout-sessionsidebar--default',
    delay: 1000,
    viewport: { width: 300, height: 600 },
  },
  {
    name: 'session-card-notion-ticket',
    storyId: 'sessions-sessioncard--with-notion-ticket',
    delay: 500,
    viewport: { width: 320, height: 200 },
  },
  {
    name: 'custom-buttons',
    storyId: 'app-full-layout--custom-buttons',
    delay: 2000,
  },
  {
    name: 'opened-as-main-branch',
    storyId: 'app-full-layout--opened-as-main-branch',
    delay: 2000,
  },
  {
    name: 'button-settings',
    storyId: 'app-full-layout--button-settings',
    delay: 2000,
    clickNav: 'Buttons',
  },
  {
    name: 'new-session-dialog',
    storyId: 'app-full-layout--new-session-dialog',
    delay: 1500,
  },
  {
    name: 'new-session-dialog-with-input',
    storyId: 'app-full-layout--new-session-dialog-with-input',
    delay: 1500,
  },
  {
    name: 'rename-session-dialog',
    storyId: 'app-full-layout--rename-session-dialog',
    delay: 3500,
  },
  {
    name: 'startup-prompt-settings',
    storyId: 'app-full-layout--startup-prompt-settings',
    delay: 2000,
    clickNav: 'Startup Prompts',
  },
  {
    name: 'startup-prompt-editor',
    storyId: 'app-full-layout--startup-prompt-editor',
    delay: 2000,
    clickNav: 'Startup Prompts',
  },
  {
    name: 'review-loop-running',
    storyId: 'app-full-layout--review-loop-running',
    delay: 2000,
  },
  {
    name: 'review-loop-completed',
    storyId: 'app-full-layout--review-loop-completed',
    delay: 2000,
  },
  {
    name: 'review-loop-settings',
    storyId: 'app-full-layout--review-loop-settings',
    delay: 2000,
    clickNav: 'Review Loop',
  },
  {
    name: 'code-attention',
    storyId: 'app-full-layout--code-attention',
    delay: 2000,
  },
  {
    name: 'pr-attention',
    storyId: 'app-full-layout--pr-attention',
    delay: 2000,
  },
  {
    name: 'tab-attention',
    storyId: 'app-full-layout--tab-attention',
    delay: 2000,
  },

  // PR review enhancements
  {
    name: 'pr-review-reviewers-mixed',
    storyId: 'pr-reviewerssection--mixed-states',
    viewport: { width: 540, height: 360 },
    delay: 600,
  },
  {
    name: 'pr-review-reviewers-pending-only',
    storyId: 'pr-reviewerssection--pending-only',
    viewport: { width: 540, height: 240 },
    delay: 600,
  },
  {
    name: 'pr-review-reviewers-empty',
    storyId: 'pr-reviewerssection--empty',
    viewport: { width: 540, height: 200 },
    delay: 600,
  },
  {
    name: 'pr-review-suggestion-singleline',
    storyId: 'pr-suggestionblock--single-line',
    viewport: { width: 600, height: 200 },
    delay: 600,
  },
  {
    name: 'pr-review-suggestion-multiline',
    storyId: 'pr-suggestionblock--multi-line',
    viewport: { width: 600, height: 260 },
    delay: 600,
  },
  {
    name: 'pr-review-suggestion-disabled',
    storyId: 'pr-suggestionblock--branch-not-checked-out',
    viewport: { width: 600, height: 200 },
    delay: 600,
  },
  {
    name: 'pr-review-inlinethread-open',
    storyId: 'pr-inlinethread--open',
    viewport: { width: 720, height: 400 },
    delay: 600,
  },
  {
    name: 'pr-review-inlinethread-resolved',
    storyId: 'pr-inlinethread--resolved',
    viewport: { width: 720, height: 200 },
    delay: 600,
  },
  {
    name: 'pr-review-inlinethread-suggestion',
    storyId: 'pr-inlinethread--with-suggestion',
    viewport: { width: 720, height: 380 },
    delay: 600,
  },
  {
    name: 'pr-review-contextmenu-fileexplorer',
    storyId: 'ui-contextmenu--file-explorer',
    viewport: { width: 480, height: 360 },
    delay: 600,
    rightClickDemo: true,
  },
  {
    name: 'pr-review-contextmenu-changedfiles',
    storyId: 'ui-contextmenu--changed-files',
    viewport: { width: 480, height: 420 },
    delay: 600,
    rightClickDemo: true,
  },

  // Claude Web sessions
  {
    name: 'claude-web-sidebar',
    storyId: 'app-full-layout--claude-web-sessions',
    delay: 2000,
    viewport: { width: 320, height: 1100 },
  },
  {
    name: 'claude-web-settings',
    storyId: 'app-full-layout--claude-web-settings',
    delay: 2000,
    clickNav: 'Project Defaults',
  },
  {
    name: 'claude-web-card',
    storyId: 'sessions-claudewebsessioncard--with-open-pr',
    viewport: { width: 380, height: 110 },
    delay: 600,
  },

  // PR sidebar sort & filter menu
  {
    name: 'pr-sort-filter-menu',
    storyId: 'pr-prsortfiltermenu--open',
    viewport: { width: 360, height: 540 },
    delay: 600,
  },
  {
    name: 'pr-sort-filter-menu-active',
    storyId: 'pr-prsortfiltermenu--filters-active',
    viewport: { width: 360, height: 580 },
    delay: 600,
  },
  {
    name: 'pr-sort-filter-menu-people',
    storyId: 'pr-prsortfiltermenu--person-picker',
    viewport: { width: 360, height: 460 },
    delay: 700,
  },

  // Diff viewer — showcases the new GitHub-style row layout, full-file
  // syntax highlighting context, and the working "Show N unchanged lines"
  // expander.
  {
    name: 'diff-viewer-unified',
    storyId: 'git-diffviewer--unified-view',
    viewport: { width: 1280, height: 720 },
    delay: 1500,
  },
  {
    name: 'diff-viewer-split',
    storyId: 'git-diffviewer--split-view',
    viewport: { width: 1280, height: 720 },
    delay: 1500,
  },
  {
    name: 'diff-viewer-unified-expanded',
    storyId: 'git-diffviewer--unified-with-expanded-context',
    viewport: { width: 1280, height: 900 },
    delay: 1500,
  },
  {
    name: 'diff-viewer-split-expanded',
    storyId: 'git-diffviewer--split-with-expanded-context',
    viewport: { width: 1280, height: 900 },
    delay: 1500,
  },
  {
    name: 'cloud-relay-popover',
    storyId: 'layout-remotetogglepopover--open-cloud-connected',
    viewport: { width: 520, height: 720 },
    delay: 600,
    clickButtonText: 'Remote',
  },
  {
    name: 'pairing-approval-prompt',
    storyId: 'layout-remotetogglepopover--open-pending-pairing',
    viewport: { width: 520, height: 720 },
    delay: 1200,
  },
  {
    name: 'cloud-receiver-handlepage',
    storyId: 'remote-handlepage--default',
    viewport: { width: 420, height: 900 },
    delay: 800,
  },
  // ── Foundry ────────────────────────────────────────────────────────────
  {
    name: 'foundry-panel-pass-running',
    storyId: 'foundry-panel--pass-running',
    viewport: { width: 460, height: 860 },
    delay: 800,
  },
  {
    name: 'foundry-panel-active-pipelines',
    storyId: 'foundry-panel--active-pipelines',
    viewport: { width: 460, height: 860 },
    delay: 800,
  },
  {
    name: 'foundry-panel-off',
    storyId: 'foundry-panel--off',
    viewport: { width: 460, height: 860 },
    delay: 600,
  },
  {
    name: 'foundry-settings-configured',
    storyId: 'settings-foundrysettings--configured',
    viewport: { width: 880, height: 900 },
    delay: 700,
  },
  {
    name: 'foundry-settings-editor',
    storyId: 'settings-foundrysettings--editor',
    viewport: { width: 880, height: 2640 },
    delay: 1200,
  },
]

async function captureScreenshots() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const launchOptions: Parameters<typeof chromium.launch>[0] = {}
  if (process.env.CHROME_BIN) {
    launchOptions.executablePath = process.env.CHROME_BIN
  }
  const browser = await chromium.launch(launchOptions)

  // Optional allowlist: SCREENSHOT_ONLY=name1,name2 captures just those targets
  // (and leaves every other docs/screenshots/*.png untouched).
  const onlyFilter = (process.env.SCREENSHOT_ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const selected = onlyFilter.length > 0
    ? targets.filter((t) => onlyFilter.includes(t.name))
    : targets

  // Capture main targets
  for (const target of selected) {
    const context = await browser.newContext({
      viewport: target.viewport ?? VIEWPORT,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const storyUrl = `${STORYBOOK_URL}/iframe.html?id=${target.storyId}&viewMode=story`
    console.log(`Capturing: ${target.name} (${target.storyId})`)

    try {
      await page.goto(storyUrl, { waitUntil: 'networkidle', timeout: 15000 })
    } catch {
      // Fall back to a less strict wait — some stories never reach networkidle
      // because of HMR / polling mocks. The per-target `delay` covers render time.
      await page.goto(storyUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)
    }

    if (target.theme) {
      await applyTheme(page, target.theme)
    }

    if (target.delay) {
      await page.waitForTimeout(target.delay)
    }

    if (target.rightClickDemo) {
      const demo = await page.$('div.bg-bg-secondary, div[class*="border-border"]')
      if (demo) {
        const box = await demo.boundingBox()
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
          await page.waitForTimeout(150)
        }
      }
    }

    if (target.clickSelector) {
      const el = await page.$(target.clickSelector)
      if (el) {
        await el.click()
        await page.waitForTimeout(300)
      }
    }

    if (target.clickButtonText) {
      await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
        const btn = buttons.find((b) => b.textContent?.trim() === text)
        if (btn) btn.click()
      }, target.clickButtonText)
      await page.waitForTimeout(400)
    }

    if (target.clickNav) {
      await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('aside button'))
        const btn = buttons.find((b) => b.textContent?.trim() === text)
        if (btn) btn.click()
      }, target.clickNav)
      await page.waitForTimeout(500)
    }

    if (target.scrollTo) {
      await page.evaluate((text) => {
        // Find heading by text content and scroll its scroll container
        const all = document.querySelectorAll('h1, h2, h3')
        const el = Array.from(all).find((e) => e.textContent?.includes(text))
        if (el) {
          // Find the nearest scrollable ancestor
          let container: HTMLElement | null = el.parentElement
          while (container) {
            const style = getComputedStyle(container)
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') break
            container = container.parentElement
          }
          if (container) {
            const rect = el.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            container.scrollTop += rect.top - containerRect.top
          }
        }
      }, target.scrollTo)
      await page.waitForTimeout(500)
    }

    const outputPath = path.join(OUTPUT_DIR, `${target.name}.png`)
    await page.screenshot({ path: outputPath })
    console.log(`  Saved: ${outputPath}`)
    await context.close()
  }

  // Capture theme variants — use the Storybook theme globals parameter
  // which the addon-themes decorator reads to set data-theme.
  // By appending &globals=theme:xxx to the URL, the decorator applies
  // the theme including proper store updates.
  const themeGlobals: Record<string, string> = {
    dark: 'Dark (Tokyo Night)',
    light: 'Light',
    'soft-light': 'Soft Light',
    'ultra-dark': 'Ultra Dark',
  }

  for (const [themeKey, themeLabel] of Object.entries(themeGlobals)) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const storyUrl = `${STORYBOOK_URL}/iframe.html?id=app-full-layout--default&viewMode=story`
    console.log(`Capturing theme: ${themeKey}`)

    try {
      await page.goto(storyUrl, { waitUntil: 'networkidle', timeout: 15000 })
    } catch {
      await page.goto(storyUrl, { waitUntil: 'domcontentloaded' })
    }
    await page.waitForTimeout(2000) // Wait for initial render + terminal output

    // Use the exposed setTheme function to sync both data-theme AND terminal colors
    await page.evaluate((t) => {
      if ((window as any).__setTheme) {
        (window as any).__setTheme(t)
      } else {
        document.documentElement.setAttribute('data-theme', t)
      }
    }, themeKey)
    // Force xterm to repaint by triggering a resize
    await page.evaluate(() => {
      window.dispatchEvent(new Event('resize'))
    })
    await page.waitForTimeout(3000) // Wait for terminal to re-render with new theme

    const outputPath = path.join(OUTPUT_DIR, `theme-${themeKey}.png`)
    await page.screenshot({ path: outputPath })
    console.log(`  Saved: ${outputPath}`)
    await context.close()
  }

  await browser.close()
  console.log(`\nDone! Screenshots saved to ${OUTPUT_DIR}`)
}

captureScreenshots().catch((err) => {
  console.error('Screenshot capture failed:', err)
  process.exit(1)
})

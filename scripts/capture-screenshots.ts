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
    scrollTo: 'Custom Buttons',
  },
]

async function captureScreenshots() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const browser = await chromium.launch()

  // Capture main targets
  for (const target of targets) {
    const context = await browser.newContext({
      viewport: target.viewport ?? VIEWPORT,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const storyUrl = `${STORYBOOK_URL}/iframe.html?id=${target.storyId}&viewMode=story`
    console.log(`Capturing: ${target.name} (${target.storyId})`)

    await page.goto(storyUrl, { waitUntil: 'networkidle' })

    if (target.theme) {
      await applyTheme(page, target.theme)
    }

    if (target.delay) {
      await page.waitForTimeout(target.delay)
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

    await page.goto(storyUrl, { waitUntil: 'networkidle' })
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

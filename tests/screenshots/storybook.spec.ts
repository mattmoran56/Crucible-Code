import { test, expect, type Page } from '@playwright/test'

interface Target {
  name: string
  storyId: string
  /** Extra wait for stories with terminals / async content. */
  delay?: number
  viewport?: { width: number; height: number }
}

const TARGETS: Target[] = [
  // Stable, content-light components first — these are the ones we *want* to
  // catch regressions on visually.
  { name: 'button-primary', storyId: 'ui-button--primary', viewport: { width: 320, height: 120 } },
  { name: 'button-ghost', storyId: 'ui-button--ghost', viewport: { width: 320, height: 120 } },
  { name: 'button-danger', storyId: 'ui-button--danger', viewport: { width: 320, height: 120 } },
  { name: 'button-loading', storyId: 'ui-button--loading', viewport: { width: 320, height: 120 } },
  { name: 'button-disabled', storyId: 'ui-button--disabled', viewport: { width: 320, height: 120 } },

  // PR review building blocks
  {
    name: 'pr-reviewers-mixed',
    storyId: 'pr-reviewerssection--mixed-states',
    viewport: { width: 540, height: 360 },
    delay: 200,
  },
  {
    name: 'pr-suggestion-singleline',
    storyId: 'pr-suggestionblock--single-line',
    viewport: { width: 600, height: 200 },
    delay: 200,
  },
  {
    name: 'pr-inlinethread-resolved',
    storyId: 'pr-inlinethread--resolved',
    viewport: { width: 720, height: 220 },
    delay: 200,
  },
]

async function gotoStory(page: Page, storyId: string) {
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`, {
    waitUntil: 'domcontentloaded',
  })
  // Storybook injects the rendered story asynchronously
  await page.waitForFunction(() => !!document.querySelector('#storybook-root *'))
}

test.describe('Storybook visual regressions', () => {
  for (const t of TARGETS) {
    test(t.name, async ({ page }) => {
      if (t.viewport) await page.setViewportSize(t.viewport)
      await gotoStory(page, t.storyId)
      if (t.delay) await page.waitForTimeout(t.delay)
      // Stabilize: disable caret blink, wait for fonts, hide focus rings
      await page.addStyleTag({
        content: `*, *::before, *::after { caret-color: transparent !important; }`,
      })
      await page.evaluate(() => document.fonts?.ready)
      await expect(page).toHaveScreenshot(`${t.name}.png`, { fullPage: false })
    })
  }
})

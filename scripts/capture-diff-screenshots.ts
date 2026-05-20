/**
 * Captures screenshots of the PR diff viewer for review. Drives the mock app
 * (npm run mock) — set MOCK_URL=... or rely on the default localhost:5199.
 *
 *   npm run mock -- --port 5199 &
 *   npx tsx scripts/capture-diff-screenshots.ts
 */
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:5199'
const OUTPUT_DIR = path.resolve(__dirname, '../docs/screenshots/diff-viewer')
const VIEWPORT = { width: 1600, height: 900 }
const PW_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const launchOptions = fs.existsSync(PW_CHROMIUM) ? { executablePath: PW_CHROMIUM } : undefined
  const browser = await chromium.launch(launchOptions)
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  const page = await context.newPage()

  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' })

  // Wait for project tabs
  await page.waitForSelector('text=CodeCrucible', { timeout: 10_000 })

  // Click PR #42
  const card = page
    .getByRole('button')
    .filter({ hasText: /^#42 / })
    .first()
  await card.click()
  await page.waitForSelector('text=/^PR #/', { timeout: 10_000 })

  // Switch to Files tab
  await page.getByRole('tab', { name: /^Files \(/ }).click()
  await page.waitForSelector('[data-line-type]', { timeout: 10_000 })
  await page.waitForTimeout(800) // let shiki finish tokenising

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'pr-diff-split.png'), fullPage: false })
  console.log('Saved pr-diff-split.png')

  // Switch to unified mode via the ToggleGroup ("Unified" radio)
  await page.getByRole('radio', { name: 'Unified', exact: true }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'pr-diff-unified.png'), fullPage: false })
  console.log('Saved pr-diff-unified.png')

  // Click "Show more lines below" — expand context
  const expander = page.locator('[data-expander-row="true"]').first()
  await expander.locator('button[data-expand-direction="down"]').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'pr-diff-unified-expanded.png'), fullPage: false })
  console.log('Saved pr-diff-unified-expanded.png')

  // Light theme too
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'pr-diff-unified-expanded-light.png'), fullPage: false })
  console.log('Saved pr-diff-unified-expanded-light.png')

  // Tight crop of just the diff body (skip sidebar + header)
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(500)
  const diffEl = page.locator('div.font-mono.text-xs').first()
  if (await diffEl.count()) {
    await diffEl.screenshot({ path: path.join(OUTPUT_DIR, 'pr-diff-zoomed.png') })
    console.log('Saved pr-diff-zoomed.png')
  }

  await context.close()
  await browser.close()
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})

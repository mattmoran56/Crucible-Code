/**
 * Capture screenshots of the diff viewer in isolation (Storybook) and
 * embedded in the full app (Git view / PR review). Run with Storybook +
 * mock servers up:
 *
 *   npm run storybook -- --ci --quiet --no-open &
 *   npm run mock -- --port 5199 &
 *   npx tsx scripts/capture-diff-screenshots.ts
 */
import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? 'http://localhost:6006'
const MOCK_URL = process.env.MOCK_URL ?? 'http://localhost:5199'
const OUTPUT_DIR = path.resolve(__dirname, '../docs/screenshots/diff-viewer')
const PW_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'

interface Target {
  name: string
  storyId: string
  viewport: { width: number; height: number }
  delay?: number
}

const STORYBOOK_TARGETS: Target[] = [
  {
    name: 'storybook-diff-unified',
    storyId: 'git-diffviewer--unified-view',
    viewport: { width: 1280, height: 720 },
    delay: 1500,
  },
  {
    name: 'storybook-diff-split',
    storyId: 'git-diffviewer--split-view',
    viewport: { width: 1280, height: 720 },
    delay: 1500,
  },
  {
    name: 'storybook-diff-unified-expanded',
    storyId: 'git-diffviewer--unified-with-expanded-context',
    viewport: { width: 1280, height: 900 },
    delay: 1500,
  },
  {
    name: 'storybook-diff-split-expanded',
    storyId: 'git-diffviewer--split-with-expanded-context',
    viewport: { width: 1280, height: 900 },
    delay: 1500,
  },
]

async function captureStorybook(browser: import('playwright').Browser) {
  for (const t of STORYBOOK_TARGETS) {
    const context = await browser.newContext({
      viewport: t.viewport,
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    const url = `${STORYBOOK_URL}/iframe.html?id=${t.storyId}&viewMode=story`
    console.log(`Capturing ${t.name}`)
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    }
    if (t.delay) await page.waitForTimeout(t.delay)
    const out = path.join(OUTPUT_DIR, `${t.name}.png`)
    await page.screenshot({ path: out })
    console.log(`  Saved ${out}`)
    await context.close()
  }
}

async function captureMockApp(browser: import('playwright').Browser) {
  const context = await browser.newContext({
    // Wider viewport so the session sidebar, files column, and diff body
    // each get enough room without overlapping.
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()

  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(MOCK_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=CodeCrucible', { timeout: 10_000 })

  // Open PR #42 → Files tab so the embedded PRDiffViewer renders the real
  // PR review surface, not just the standalone component.
  await page
    .getByRole('button')
    .filter({ hasText: /^#42 / })
    .first()
    .click()
  await page.waitForSelector('text=/^PR #/', { timeout: 10_000 })
  await page.getByRole('tab', { name: /^Files \(/ }).click()
  await page.waitForSelector('[data-line-type]', { timeout: 10_000 })
  await page.waitForTimeout(800)

  // Collapse the file-list sidebar inside the PR panel so the diff viewer
  // gets a wider canvas — much more like the real workflow once a file
  // has been selected for focused review.
  const collapseBtn = page.getByRole('button', { name: 'Collapse file list' })
  if (await collapseBtn.count()) {
    await collapseBtn.click()
    await page.waitForTimeout(300)
  }

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'app-pr-files-split.png') })
  console.log('  Saved app-pr-files-split.png')

  await page.getByRole('radio', { name: 'Unified', exact: true }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'app-pr-files-unified.png') })
  console.log('  Saved app-pr-files-unified.png')

  // Trigger the expander to demonstrate "Show more lines" working end-to-end.
  const expander = page.locator('[data-expander-row="true"]').first()
  if (await expander.count()) {
    await expander.locator('button[data-expand-direction="down"]').click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'app-pr-files-unified-expanded.png') })
    console.log('  Saved app-pr-files-unified-expanded.png')
  }

  // Tight crop of just the diff column (PR toolbar + diff body) for use in
  // PR descriptions where the surrounding sidebar adds noise.
  const diffArea = page.locator('div.font-mono.text-xs').first()
  if (await diffArea.count()) {
    await diffArea.screenshot({ path: path.join(OUTPUT_DIR, 'app-pr-diff-zoomed.png') })
    console.log('  Saved app-pr-diff-zoomed.png')
  }

  await context.close()
}

async function main() {
  // Wipe old, stale screenshots that don't match the new naming scheme so
  // the directory only contains current artefacts.
  if (fs.existsSync(OUTPUT_DIR)) {
    for (const f of fs.readdirSync(OUTPUT_DIR)) {
      fs.unlinkSync(path.join(OUTPUT_DIR, f))
    }
  } else {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const launchOptions = fs.existsSync(PW_CHROMIUM) ? { executablePath: PW_CHROMIUM } : undefined
  const browser = await chromium.launch(launchOptions)

  console.log('Capturing Storybook stories…')
  await captureStorybook(browser)

  console.log('Capturing mock app PR view…')
  await captureMockApp(browser)

  await browser.close()
  console.log(`\nDone. Screenshots saved to ${OUTPUT_DIR}`)
}

main().catch((err) => {
  console.error('Capture failed:', err)
  process.exit(1)
})

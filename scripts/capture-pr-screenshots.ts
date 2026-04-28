/**
 * One-off capture of the per-agent attention screenshots for the PR description.
 * Avoids networkidle (which hangs in this Storybook setup) and writes to /tmp.
 */

import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? 'http://localhost:6006'
const OUTPUT_DIR = path.resolve(__dirname, '../docs/screenshots/pr-agent-attention')
const VIEWPORT = { width: 1440, height: 900 }

const targets = [
  { name: 'code-attention', storyId: 'app-full-layout--code-attention' },
  { name: 'pr-attention', storyId: 'app-full-layout--pr-attention' },
  { name: 'tab-attention', storyId: 'app-full-layout--tab-attention' },
]

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const browser = await chromium.launch()
  for (const t of targets) {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const url = `${STORYBOOK_URL}/iframe.html?id=${t.storyId}&viewMode=story`
    console.log(`Capturing ${t.name}: ${url}`)
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    // Storybook + xterm need a beat to settle before xterm sizes correctly.
    await page.waitForTimeout(3000)
    // Forcibly remove the LoadingScreen overlay since some mock loaders never
    // resolve in Storybook, leaving Promise.all pending and the screen mounted.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('div'))) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed' && cs.zIndex === '9999') el.remove()
      }
    })
    await page.waitForTimeout(1000)
    const out = path.join(OUTPUT_DIR, `${t.name}.png`)
    await page.screenshot({ path: out })
    console.log(`  Saved: ${out}`)
    await context.close()
  }
  await browser.close()
}

main().catch((err) => {
  console.error('Failed:', err)
  process.exit(1)
})

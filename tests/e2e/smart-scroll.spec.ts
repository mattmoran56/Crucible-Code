import { test, expect, type Page } from '@playwright/test'

/**
 * E2E coverage for the smart-scroll behaviour in the agent terminal.
 *
 * Bug: while a session's pty streams output, the xterm viewport followed the
 * cursor on every write — so a user who scrolled up to read past content was
 * yanked back to the bottom on the next chunk.
 *
 * Fix: see src/renderer/components/terminal/smartScroll.ts. This test drives
 * the actual app against the mock backend (which streams ~50 lines over a few
 * seconds) and asserts the user-set scroll position survives subsequent
 * writes.
 */

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('CodeCrucible').first()).toBeVisible({ timeout: 10_000 })
}

async function openTerminalSession(page: Page) {
  // Activating a session card auto-spawns a terminal (TerminalPanel useEffect).
  const card = page.getByText('fix-terminal-resize').first()
  await card.click()
}

async function viewport(page: Page) {
  return page.locator('.xterm-viewport').first()
}

test.describe('Agent terminal — smart scroll', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('scrolling up while data streams keeps the user at their position', async ({ page }) => {
    await openTerminalSession(page)
    const vp = await viewport(page)
    await expect(vp).toBeVisible({ timeout: 10_000 })

    // Wait until the viewport has accumulated enough content to be scrollable.
    await expect
      .poll(async () => vp.evaluate((el: HTMLElement) => el.scrollHeight - el.clientHeight), {
        timeout: 5_000,
      })
      .toBeGreaterThan(20)

    // Scroll up to roughly the top while the mock is still streaming.
    await vp.evaluate((el: HTMLElement) => {
      el.scrollTop = 0
    })
    const scrollTopAfterUserScroll = await vp.evaluate((el: HTMLElement) => el.scrollTop)
    expect(scrollTopAfterUserScroll).toBe(0)

    // Let more data stream in. The mock pushes one chunk every 80ms for ~50
    // chunks; 1.5s gives us plenty of writes after we scrolled.
    await page.waitForTimeout(1500)

    // Without smart-scroll, scrollTop would have been forced back near
    // (scrollHeight - clientHeight). With it, we should still be near the top.
    const finalScrollTop = await vp.evaluate((el: HTMLElement) => el.scrollTop)
    const finalDistanceFromBottom = await vp.evaluate(
      (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop,
    )
    expect(finalScrollTop).toBeLessThan(20)
    expect(finalDistanceFromBottom).toBeGreaterThan(20)
  })

  test('returning to the bottom re-engages auto-follow', async ({ page }) => {
    await openTerminalSession(page)
    const vp = await viewport(page)
    await expect(vp).toBeVisible({ timeout: 10_000 })

    await expect
      .poll(async () => vp.evaluate((el: HTMLElement) => el.scrollHeight - el.clientHeight), {
        timeout: 5_000,
      })
      .toBeGreaterThan(20)

    // Scroll up, then back to the bottom.
    await vp.evaluate((el: HTMLElement) => {
      el.scrollTop = 0
    })
    await page.waitForTimeout(200)
    await vp.evaluate((el: HTMLElement) => {
      el.scrollTop = el.scrollHeight
    })

    // After streaming continues, we should remain anchored at the bottom.
    await page.waitForTimeout(1000)
    const distanceFromBottom = await vp.evaluate(
      (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop,
    )
    expect(distanceFromBottom).toBeLessThan(10)
  })
})

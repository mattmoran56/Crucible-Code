import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * E2E coverage for the smart-scroll behaviour in workspace terminals. The
 * Agent tab is a visual agent now, so this drives a "New Terminal" tab.
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
  const card = page.getByText('fix-terminal-resize').first()
  await card.click()
  // Opening a terminal tab spawns a shell, which the mock streams output into.
  await page.getByRole('button', { name: 'Add tab' }).first().click()
  await page.getByText('New Terminal').click()
}

async function viewport(page: Page) {
  return page.locator('.xterm-viewport').filter({ visible: true }).first()
}

/**
 * Scroll the terminal the way a user does: with the mouse wheel over it.
 *
 * Don't assign `.xterm-viewport.scrollTop` directly: a bare assignment
 * carries no user input, so it bypasses the smart-scroll controller's input
 * tracking, and xterm can drop its scroll event when it coalesces with one of
 * xterm's own repaints (see the comment in smartScroll.ts).
 */
async function wheel(page: Page, vp: Locator, deltaY: number) {
  // The viewport sits under .xterm-screen, so hover the terminal itself.
  await vp.locator('xpath=..').hover()
  await page.mouse.wheel(0, deltaY)
}

test.describe('Workspace terminal — smart scroll', () => {
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

    // Scroll up to the top while the mock is still streaming.
    await wheel(page, vp, -100_000)
    await expect.poll(() => vp.evaluate((el: HTMLElement) => el.scrollTop)).toBe(0)

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
    await wheel(page, vp, -100_000)
    await expect.poll(() => vp.evaluate((el: HTMLElement) => el.scrollTop)).toBe(0)
    await wheel(page, vp, 100_000)

    // After streaming continues, we should remain anchored at the bottom.
    await page.waitForTimeout(1000)
    const distanceFromBottom = await vp.evaluate(
      (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop,
    )
    expect(distanceFromBottom).toBeLessThan(10)
  })
})

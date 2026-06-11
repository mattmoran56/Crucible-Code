import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

async function openSettings(page: Page) {
  await page.locator('button[title="Settings"]').click()
  await expect(page.getByText('Appearance').first()).toBeVisible({ timeout: 10_000 })
}

function rootBg(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
  )
}

test.describe('Theme switching', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('switching the theme changes the --color-bg design token', async ({ page }) => {
    await openSettings(page)
    const before = await rootBg(page)
    await page.getByText('Light', { exact: true }).first().click()
    await expect.poll(() => rootBg(page)).not.toBe(before)
  })

  test('the chosen theme survives a reload (persisted)', async ({ page }) => {
    await openSettings(page)
    await page.getByText('Light', { exact: true }).first().click()
    const lightBg = await rootBg(page)
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
    await expect.poll(() => rootBg(page)).toBe(lightBg)
  })

  test('switching back to the dark theme restores the original token', async ({ page }) => {
    await openSettings(page)
    const darkBg = await rootBg(page)
    await page.getByText('Light', { exact: true }).first().click()
    await expect.poll(() => rootBg(page)).not.toBe(darkBg)
    await page.getByText('Tokyo Night', { exact: true }).first().click()
    await expect.poll(() => rootBg(page)).toBe(darkBg)
  })
})

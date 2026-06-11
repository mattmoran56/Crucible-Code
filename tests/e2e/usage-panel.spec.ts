import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

async function openUsagePanel(page: Page) {
  await page.getByRole('button', { name: 'Usage', exact: true }).click()
}

test.describe('Usage panel — rate limits', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('shows the Rate Limits section heading', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
  })

  test('renders the five-hour window percentage from mock usage', async ({ page }) => {
    await openUsagePanel(page)
    // mockSessionUsage.fiveHour.usedPercentage = 34
    await expect(page.getByText('34%')).toBeVisible()
  })

  test('renders the seven-day window percentage from mock usage', async ({ page }) => {
    await openUsagePanel(page)
    // mockSessionUsage.sevenDay.usedPercentage = 12
    await expect(page.getByText('12%')).toBeVisible()
  })

  test('closes when clicking the Usage button again', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.getByText('Rate Limits', { exact: true })).not.toBeVisible()
  })
})

test.describe('Usage panel — session cost', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('shows the total session cost from mock data', async ({ page }) => {
    await openUsagePanel(page)
    // mockSessionUsage.cost.totalCostUsd = 2.47
    await expect(page.getByText(/\$2\.47/)).toBeVisible()
  })

  test('shows lines added and removed', async ({ page }) => {
    await openUsagePanel(page)
    // totalLinesAdded: 342, totalLinesRemoved: 87
    await expect(page.getByText(/342/)).toBeVisible()
    await expect(page.getByText(/87/)).toBeVisible()
  })
})

test.describe('Usage panel — stays scoped to the active session', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('panel persists across session switches within a project', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
    await page.getByText('fix-terminal-resize').first().click()
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
  })
})

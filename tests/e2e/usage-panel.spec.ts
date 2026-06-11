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

  test('shows "no data" for both windows until a session pushes usage', async ({ page }) => {
    // The mock backend never fires usage.onSessionUpdate, so the rate-limit
    // rows render their empty states.
    await openUsagePanel(page)
    await expect(page.getByText(/5-hour: no data/)).toBeVisible()
    await expect(page.getByText(/7-day: no data/)).toBeVisible()
  })

  test('closes when clicking the Usage button again', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.getByText('Rate Limits', { exact: true })).not.toBeVisible()
  })
})

test.describe('Usage panel — weekly activity', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('active session section waits for data', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Active Session')).toBeVisible()
    await expect(page.getByText('Waiting for data...')).toBeVisible()
  })

  test('This Week totals aggregate the seven mock days', async ({ page }) => {
    await openUsagePanel(page)
    // Sums over mockUsageStats.dailyActivity: 383 messages, 25 sessions,
    // 1,073 tool calls.
    await expect(page.getByText('This Week')).toBeVisible()
    await expect(page.getByText('383', { exact: true })).toBeVisible()
    await expect(page.getByText('25', { exact: true })).toBeVisible()
    await expect(page.getByText('1,073', { exact: true })).toBeVisible()
  })

  test('labels the weekly metric columns', async ({ page }) => {
    await openUsagePanel(page)
    await expect(page.getByText('Messages')).toBeVisible()
    await expect(page.getByText('Sessions', { exact: true }).last()).toBeVisible()
    await expect(page.getByText('Tool calls')).toBeVisible()
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

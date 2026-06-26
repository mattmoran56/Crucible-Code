import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('PR Stacks', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('opening the panel and creating a stack shows it in the list', async ({ page }) => {
    await page.getByRole('button', { name: 'PR Stacks', exact: true }).click()
    // Empty state until a stack is created.
    await expect(page.getByText('No stacks yet.', { exact: false })).toBeVisible({ timeout: 10_000 })

    await page.getByRole('button', { name: 'New stack', exact: true }).click()
    // A stack row appears; selecting it opens the detail view with Add PR.
    await expect(page.getByText('Stack 1', { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.getByText('Stack 1', { exact: true }).click()
    await expect(page.getByRole('button', { name: '+ Add PR', exact: true })).toBeVisible()
    // App stays alive.
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible()
  })

  test('publishing an empty stack keeps the app alive', async ({ page }) => {
    await page.getByRole('button', { name: 'PR Stacks', exact: true }).click()
    await page.getByRole('button', { name: 'New stack', exact: true }).click()
    await page.getByText('Stack 1', { exact: true }).click()
    // Publish is disabled with no entries; the panel still renders without error.
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible()
  })
})

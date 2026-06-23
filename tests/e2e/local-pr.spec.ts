import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('Local PRs', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('creating a local PR from a session shows a Local badge + Promote action', async ({ page }) => {
    // fix-terminal-resize is a session with no existing PR — a clean target.
    const card = page.locator('text=fix-terminal-resize').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.hover()

    // Open the session's actions menu and create a local PR.
    await page.getByRole('button', { name: 'Actions for fix-terminal-resize', exact: true }).click({ force: true })
    await page.getByText('Create local PR', { exact: true }).click()

    // The local PR surfaces in the PR list with a Local badge + Promote action.
    await expect(page.getByText('Local', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Promote to PR', { exact: true }).first()).toBeVisible()
  })

  test('promoting a local PR resolves without error', async ({ page }) => {
    const card = page.locator('text=fix-terminal-resize').first()
    await expect(card).toBeVisible({ timeout: 10_000 })
    await card.hover()
    await page.getByRole('button', { name: 'Actions for fix-terminal-resize', exact: true }).click({ force: true })
    await page.getByText('Create local PR', { exact: true }).click()

    const promote = page.getByText('Promote to PR', { exact: true }).first()
    await expect(promote).toBeVisible({ timeout: 10_000 })
    await promote.click()
    // App stays alive (the project tab is still rendered) after promote.
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

async function openWorktreeTab(page: Page) {
  await page.getByRole('tab', { name: 'Worktree' }).click()
}

test.describe('Worktree (git) view', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('the Worktree tab is available in the workspace', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Worktree' })).toBeVisible({ timeout: 10_000 })
  })

  test('shows the commit list from mock git log', async ({ page }) => {
    await openWorktreeTab(page)
    await expect(
      page.getByText('Add PR review panel with conversation tab').first()
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('Initial project setup with Electron + React').first()
    ).toBeVisible()
  })

  test('shows an Uncommitted Changes entry above commits', async ({ page }) => {
    await openWorktreeTab(page)
    await expect(page.getByText('Uncommitted Changes').first()).toBeVisible({ timeout: 10_000 })
  })

  test('selecting a commit lists its changed files', async ({ page }) => {
    await openWorktreeTab(page)
    await page.getByText('Add PR review panel with conversation tab').first().click()
    await expect(page.getByText('PRReviewPanel.tsx').first()).toBeVisible()
    await expect(page.getByText('FileTree.tsx').first()).toBeVisible()
  })

  test('selecting a changed file renders the unified diff', async ({ page }) => {
    await openWorktreeTab(page)
    await page.getByText('Add PR review panel with conversation tab').first().click()
    await page.getByText('PRReviewPanel.tsx').first().click()
    // The mock unified diff adds this import line
    await expect(page.getByText(/PRConversationTab/).first()).toBeVisible()
  })

  test('commit authors are shown', async ({ page }) => {
    await openWorktreeTab(page)
    await expect(page.getByText('Alice').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Bob').first()).toBeVisible()
  })
})

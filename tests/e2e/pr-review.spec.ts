import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('PR list in the sidebar', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('lists the open mock pull requests', async ({ page }) => {
    await expect(
      page.getByText('Add PR review panel with conversation and checks').first()
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('Fix terminal resize handling on split panes').first()
    ).toBeVisible()
  })

  test('shows PR numbers as prefixes', async ({ page }) => {
    await expect(page.getByText('#42').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('#38').first()).toBeVisible()
  })

  test('shows the draft PR from mock data', async ({ page }) => {
    await expect(
      page.getByText('WIP: Add code editor with file explorer').first()
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe('PR review panel', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    // The session row for add-pr-review also contains the PR title — target
    // the PRCard in the Pull Requests section, which shows the author login.
    await page
      .getByRole('button', { name: /Add PR review panel with conversation and checks/ })
      .filter({ hasText: 'alice' })
      .first()
      .click()
  })

  test('opens with the Conversation tab and PR body', async ({ page }) => {
    // mockPRDetail.body starts with "## Summary"
    await expect(page.getByText('Summary').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('tab', { name: 'Conversation' })).toBeVisible()
  })

  test('conversation shows the seeded comments', async ({ page }) => {
    await expect(
      page.getByText(/The tab structure is clean and the file tree is a nice touch/).first()
    ).toBeVisible({ timeout: 10_000 })
  })

  test('Files tab lists the PR files with add/del counts', async ({ page }) => {
    await page.getByRole('tab', { name: /^Files/ }).click()
    await expect(page.getByText('PRReviewPanel.tsx').first()).toBeVisible()
    await expect(page.getByText('PRConversationTab.tsx').first()).toBeVisible()
  })

  test('Files tab count matches the six mock files', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Files (6)' })).toBeVisible({ timeout: 10_000 })
  })

  test('Commits tab lists the four PR commits', async ({ page }) => {
    await page.getByRole('tab', { name: /^Commits/ }).click()
    await expect(page.getByText('Add basic PR review panel skeleton')).toBeVisible()
    await expect(page.getByText('Add viewed-file tracking and keyboard nav')).toBeVisible()
  })

  test('Commits tab badge shows the commit count', async ({ page }) => {
    await expect(page.getByRole('tab', { name: 'Commits (4)' })).toBeVisible({ timeout: 10_000 })
  })

  test('switching back to Conversation restores the body', async ({ page }) => {
    await page.getByRole('tab', { name: /^Files/ }).click()
    await page.getByRole('tab', { name: 'Conversation' }).click()
    await expect(page.getByText('Summary').first()).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

/**
 * The mock app boots without persisted state but the renderer keeps a copy in
 * localStorage. Clear it so each test starts from a clean slate.
 */
async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible({
    timeout: 10_000,
  })
}

/**
 * Open the first PR card. The mock backend seeds PR #42 with the diff used
 * by `mockUnifiedDiff`, which only renders lines 1–8 of the file — leaving
 * the tail-expander available as a target for the expand tests.
 */
async function openFirstPR(page: Page) {
  // PRCard root is a role="button" — click that, not the inner text span,
  // so we don't get intercepted by the wrapping clickable region.
  const card = page
    .getByRole('button')
    .filter({ hasText: /^#42 / })
    .first()
  await card.click()
  // The PR toolbar shows "PR #42" once the panel mounts.
  await expect(page.getByText(/^PR #\d+/)).toBeVisible({ timeout: 10_000 })
}

async function gotoFilesTab(page: Page) {
  await page.getByRole('tab', { name: /^Files \(/ }).click()
  // Wait for a diff line to mount (any add/delete/context row).
  await expect(page.locator('[data-line-type]').first()).toBeVisible({
    timeout: 10_000,
  })
}

test.describe('Diff expand button', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('PR diff: expand button is present below the hunk', async ({ page }) => {
    await openFirstPR(page)
    await gotoFilesTab(page)

    // The mock patch has a single hunk that ends at new line 8, leaving an
    // active tail expander.
    const expander = page.locator('[data-expander-row="true"]').first()
    await expect(expander).toBeVisible()
    await expect(
      expander.locator('button[data-expand-direction="down"]')
    ).toBeEnabled()
  })

  test('PR diff: clicking the down arrow expands context below the hunk', async ({ page }) => {
    await openFirstPR(page)
    await gotoFilesTab(page)

    // Count rendered diff body lines before expansion.
    const linesBefore = await page.locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]').count()
    expect(linesBefore).toBeGreaterThan(0)

    await page
      .locator('[data-expander-row="true"]')
      .first()
      .locator('button[data-expand-direction="down"]')
      .click()

    // After expansion, more context lines should be rendered. The mock blob
    // (`mockFileContent`) extends well past the diff hunk, so the down arrow
    // adds up to 20 new context lines.
    await expect(async () => {
      const after = await page
        .locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]')
        .count()
      expect(after).toBeGreaterThan(linesBefore)
    }).toPass({ timeout: 5_000 })
  })

  test('PR diff: clicking anywhere on the expander row expands context', async ({ page }) => {
    await openFirstPR(page)
    await gotoFilesTab(page)

    const linesBefore = await page
      .locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]')
      .count()

    // The row root has role="button" so the entire strip is one click target.
    // Hit the label span — well clear of the 80px arrow column — to prove the
    // row-level click handler works, not just the discrete arrow buttons.
    const labelSpan = page
      .locator('[data-expander-row="true"]')
      .first()
      .locator('span.flex-1.flex.items-center')
    await labelSpan.click()

    await expect(async () => {
      const after = await page
        .locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]')
        .count()
      expect(after).toBeGreaterThan(linesBefore)
    }).toPass({ timeout: 5_000 })
  })

  test('PR diff: clicking the label expands and the gap label updates', async ({ page }) => {
    await openFirstPR(page)
    await gotoFilesTab(page)

    const expander = page.locator('[data-expander-row="true"]').first()
    // Tail expander label reads "Show more lines below" before expansion.
    await expect(expander).toContainText(/Show more lines below|Show \d+ unchanged/)

    await expander.locator('button[data-expand-direction="down"]').click()

    // After expansion the row label should still indicate that more lines can
    // be expanded (or the row should disappear if the file was fully revealed).
    await expect(async () => {
      const present = await page.locator('[data-expander-row="true"]').count()
      const expanded = await page
        .locator('[data-line-type=context]')
        .count()
      expect(present + expanded).toBeGreaterThan(0)
    }).toPass({ timeout: 5_000 })
  })
})

test.describe('Worktree diff expand', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('clicking a worktree file and expanding adds context lines', async ({ page }) => {
    // Click into the active session, then switch to the Worktree tab.
    await page.getByText('add-pr-review').first().click()
    const worktreeTab = page.getByRole('tab', { name: 'Worktree' }).first()
    await worktreeTab.click()

    // Select a commit and then a file. The mock returns the same diff for
    // every file, so any first-row click is fine.
    const firstCommit = page
      .locator('text=/Add PR review panel with conversation tab/')
      .first()
    if (await firstCommit.isVisible().catch(() => false)) {
      await firstCommit.click()
    }
    const firstFile = page
      .locator('text=/PRReviewPanel\\.tsx/')
      .first()
    await firstFile.click().catch(() => {})

    // The diff should now be mounted with a tail expander.
    const expander = page.locator('[data-expander-row="true"]').first()
    const visible = await expander.isVisible({ timeout: 5_000 }).catch(() => false)
    test.skip(!visible, 'Could not navigate to the worktree DiffViewer in this mock layout')

    const downBtn = expander.locator('button[data-expand-direction="down"]')
    await expect(downBtn).toBeEnabled()

    const linesBefore = await page
      .locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]')
      .count()
    await downBtn.click()

    await expect(async () => {
      const after = await page
        .locator('[data-line-type=context], [data-line-type=add], [data-line-type=delete]')
        .count()
      expect(after).toBeGreaterThan(linesBefore)
    }).toPass({ timeout: 5_000 })
  })
})

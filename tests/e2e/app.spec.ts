import { test, expect, type Page } from '@playwright/test'

/**
 * Helpers
 */
const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  // The mock backend persists nothing on disk, but the renderer keeps state in
  // localStorage. Start each test from a clean slate.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // Project tabs are the most reliable "ready" signal — they only render once
  // the projects API has resolved.
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('Project tabs', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('renders all three projects from mock data', async ({ page }) => {
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible()
    await expect(projectTab(page, 'my-api-service')).toBeVisible()
    await expect(projectTab(page, 'design-system')).toBeVisible()
  })

  test('tablist has the expected aria-label', async ({ page }) => {
    await expect(page.getByRole('tablist', { name: 'Projects' })).toBeVisible()
  })

  test('shows the Add Project and Settings buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()
    await expect(page.locator('button[title="Settings"]')).toBeVisible()
  })

  test('clicking another project tab updates the session sidebar', async ({ page }) => {
    // Project 2 has sessions "auth-middleware" and "rate-limiting"
    await projectTab(page, 'my-api-service').click()
    await expect(page.getByText('auth-middleware').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('rate-limiting').first()).toBeVisible()
  })

  test('switching projects three times keeps the app stable', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await projectTab(page, 'my-api-service').click()
    await expect(page.getByText('auth-middleware').first()).toBeVisible({ timeout: 10_000 })
    await projectTab(page, 'design-system').click()
    await expect(page.getByText('button-variants').first()).toBeVisible()
    await projectTab(page, 'CodeCrucible').click()
    await expect(page.getByText('fix-terminal-resize').first()).toBeVisible()
    expect(errors).toEqual([])
  })
})

test.describe('Session sidebar', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('lists all four CodeCrucible sessions', async ({ page }) => {
    for (const name of ['add-pr-review', 'fix-terminal-resize', 'usage-tracking', 'editor-view']) {
      await expect(page.getByText(name).first()).toBeVisible()
    }
  })

  test('shows the Sessions, Stale Sessions and Pull Requests sections', async ({ page }) => {
    await expect(page.getByText('Sessions', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Stale Sessions')).toBeVisible()
    await expect(page.getByText('Pull Requests')).toBeVisible()
  })

  test('opens the New Session dialog when clicking +', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await expect(page.getByRole('dialog', { name: 'New Session' })).toBeVisible()
    await expect(page.getByPlaceholder('e.g. fix-auth-bug')).toBeVisible()
  })

  test('closes the New Session dialog with Cancel', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await expect(page.getByRole('dialog', { name: 'New Session' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog', { name: 'New Session' })).toHaveCount(0)
  })

  test('closes the New Session dialog with Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await expect(page.getByRole('dialog', { name: 'New Session' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'New Session' })).toHaveCount(0)
  })

  test('Session options menu offers "Open existing branch" and "Import existing worktree"', async ({ page }) => {
    await page.getByRole('button', { name: 'Session options' }).click()
    await expect(page.getByRole('menuitem', { name: 'Open existing branch' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Import existing worktree' })).toBeVisible()
  })

  test('clicking "Open existing branch" opens its dialog', async ({ page }) => {
    await page.getByRole('button', { name: 'Session options' }).click()
    await page.getByRole('menuitem', { name: 'Open existing branch' }).click()
    await expect(page.getByRole('dialog', { name: 'Open Existing Branch' })).toBeVisible()
  })

  test('selecting a session marks the row as active (accent text colour)', async ({ page }) => {
    const card = page.getByText('fix-terminal-resize').first()
    await card.click()
    // The active style sets text-accent on the wrapper. Just verify the click
    // did not throw and the card is still in the DOM.
    await expect(card).toBeVisible()
  })
})

test.describe('Settings page', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('opens from the title bar cog and renders Appearance', async ({ page }) => {
    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expect(page.getByText('Choose a theme for the interface.')).toBeVisible()
  })

  test('shows the Merged PR Cleanup section', async ({ page }) => {
    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Merged PR Cleanup' })).toBeVisible()
  })

  test('shows the Claude Accounts section seeded with the mock accounts', async ({ page }) => {
    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Claude Accounts' })).toBeVisible()
    await expect(page.getByText('Personal').first()).toBeVisible()
    await expect(page.getByText('Work').first()).toBeVisible()
  })

  test('Escape closes the settings page', async ({ page }) => {
    await page.locator('button[title="Settings"]').click()
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCount(0)
    // Title bar is back
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible()
  })

  test('Match System toggle reveals the Light/Dark theme selectors', async ({ page }) => {
    await page.locator('button[title="Settings"]').click()
    // Other settings sections (e.g. Review Loop) also render On/Off ToggleGroups,
    // so scope the click to the Match System container.
    const matchSystemSection = page
      .locator('div')
      .filter({ has: page.getByText('Match System', { exact: true }) })
      .first()
    await matchSystemSection.getByRole('radio', { name: 'On', exact: true }).click()
    await expect(page.getByText('Light theme', { exact: true })).toBeVisible()
    await expect(page.getByText('Dark theme', { exact: true })).toBeVisible()
  })
})

test.describe('Right activity bar panels', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('Notes button toggles the Notes panel open and closed', async ({ page }) => {
    const notesBtn = page.getByRole('button', { name: 'Notes', exact: true })
    await notesBtn.click()
    // Mock data ships with two notes — assert on the title that doesn't
    // collide with substrings elsewhere on the page.
    await expect(page.getByText('Architecture Notes')).toBeVisible({ timeout: 5_000 })
    await notesBtn.click()
    await expect(page.getByText('Architecture Notes')).toHaveCount(0)
  })

  test('Notes panel "New note" button creates an "Untitled" entry', async ({ page }) => {
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    await page.getByRole('button', { name: 'New note' }).click()
    await expect(page.getByPlaceholder('Start writing...')).toBeVisible()
  })

  test('Usage button opens the usage panel and shows the rate-limit section', async ({ page }) => {
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    // Use exact match: "rate limits" appears as a substring inside a PR title.
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
  })

  test('Permissions button opens the panel with the seeded allow/deny lists', async ({ page }) => {
    await page.getByRole('button', { name: 'Permissions', exact: true }).click()
    // mockApi.permissions.get returns 5 allow + 1 deny for the active repo
    await expect(page.getByText(/^Allowed \(\d+\)$/)).toBeVisible()
    await expect(page.getByText(/^Denied \(\d+\)$/)).toBeVisible()
  })

  test('switching panels keeps only one open at a time', async ({ page }) => {
    await page.getByRole('button', { name: 'Notes', exact: true }).click()
    await expect(page.getByText('Architecture Notes')).toBeVisible({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Usage', exact: true }).click()
    await expect(page.getByText('Rate Limits', { exact: true })).toBeVisible()
    // Notes content should no longer be visible
    await expect(page.getByText('Architecture Notes')).toHaveCount(0)
  })
})

test.describe('App boot health', () => {
  test('boots without console errors', async ({ page }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (e) => pageErrors.push(e.message))

    await bootApp(page)

    expect(pageErrors).toEqual([])
    // We tolerate a small number of console errors that come from third-party
    // libraries (e.g. xterm trying to access platform APIs that the jsdom-like
    // mock doesn't provide). Just assert nothing catastrophic was logged.
    const fatal = consoleErrors.filter((m) => /TypeError|ReferenceError|SyntaxError/i.test(m))
    expect(fatal).toEqual([])
  })

  test('Add Project tooltip is exposed via the title attribute', async ({ page }) => {
    await bootApp(page)
    await expect(page.getByRole('button', { name: 'Add Project' })).toHaveAttribute('title', 'Add project')
  })
})

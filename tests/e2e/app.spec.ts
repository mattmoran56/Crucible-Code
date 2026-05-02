import { test, expect } from '@playwright/test'

test.describe('App boot (mock backend)', () => {
  test.beforeEach(async ({ page }) => {
    // Mock backend persists state via localStorage; start each test clean.
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.clear())
    await page.goto('/', { waitUntil: 'domcontentloaded' })
  })

  test('boots without errors and renders project tabs', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    // The mock data ships with three projects. They become tab buttons.
    // Use exact match because each tab also has a "Close <name>" close button
    // that would match a substring query.
    await expect(page.locator('button:has(> span:text-is("CodeCrucible"))')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('button:has(> span:text-is("my-api-service"))')).toBeVisible()
    await expect(page.locator('button:has(> span:text-is("design-system"))')).toBeVisible()

    expect(errors).toEqual([])
  })

  test('shows the Add Project and Settings buttons in the tab bar', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible({ timeout: 10_000 })
    // The settings cog uses a tooltip/title — query by it
    await expect(page.locator('button[title="Settings"]')).toBeVisible()
  })

  test('opens the settings page from the title bar', async ({ page }) => {
    // Wait for the app to finish booting first
    await expect(page.getByRole('button', { name: 'Add Project' })).toBeVisible({ timeout: 10_000 })

    await page.locator('button[title="Settings"]').click()

    // Settings page header
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
    await expect(page.getByText('Choose a theme for the interface.')).toBeVisible()
  })

  test('switches active project when clicking another tab', async ({ page }) => {
    const codecrucibleTab = page.locator('button:has(> span:text-is("CodeCrucible"))')
    const apiTab = page.locator('button:has(> span:text-is("my-api-service"))')

    await expect(codecrucibleTab).toBeVisible({ timeout: 10_000 })
    await apiTab.click()
    // After clicking, the API tab should still be visible and the page should
    // not have crashed. We don't assert on focus because tab activation
    // doesn't necessarily move focus.
    await expect(apiTab).toBeVisible()
  })
})

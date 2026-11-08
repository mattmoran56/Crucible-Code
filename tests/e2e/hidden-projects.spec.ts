import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) => page.getByRole('tab', { name })

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('Hidden projects', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('hide a project from its tab, then find and unhide it in Settings', async ({ page }) => {
    await projectTab(page, 'design-system').click({ button: 'right' })
    await page.getByText('Hide Project', { exact: true }).click()
    await expect(projectTab(page, 'design-system')).toHaveCount(0)
    await expect(projectTab(page, 'CodeCrucible')).toBeVisible()

    await page.locator('button[title="Settings"]').click()
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    const hidden = page.getByRole('region', { name: 'Hidden projects' })
    await expect(hidden.getByText('design-system', { exact: true })).toBeVisible()

    await hidden.getByRole('button', { name: 'Unhide design-system' }).click()
    await expect(hidden.getByText('design-system', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(projectTab(page, 'design-system')).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

test.describe('Custom buttons — session toolbar', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('renders the seeded session-toolbar buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Run Tests' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lint & Fix' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Review Code' })).toBeVisible()
  })

  test('renders the project-tabs placement buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Build' })).toBeVisible()
  })

  test('grouped buttons collapse behind their group label', async ({ page }) => {
    // grp-1 "Deploy" contains Deploy + Deploy Staging for proj-1
    await expect(page.getByRole('button', { name: 'Deploy', exact: true })).toBeVisible()
    // The grouped children only render inside the dropdown menu after a click
    await expect(page.getByRole('menuitem', { name: 'Deploy Staging' })).not.toBeVisible()
  })

  test('opening the Deploy group shows its child buttons', async ({ page }) => {
    await page.getByRole('button', { name: 'Deploy', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Deploy Staging' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Deploy', exact: true })).toBeVisible()
  })

  test('a confirm-message button opens a confirmation dialog before running', async ({ page }) => {
    await page.getByRole('button', { name: 'Deploy', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Deploy', exact: true }).click()
    await expect(
      page.getByText('Are you sure you want to deploy to production?')
    ).toBeVisible()
  })

  test('project-scoped buttons disappear when switching to another project', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Deploy', exact: true })).toBeVisible()
    await projectTab(page, 'design-system').click()
    await expect(page.getByText('button-variants').first()).toBeVisible({ timeout: 10_000 })
    // Deploy group is scoped to proj-1 only; Build is global and stays.
    await expect(page.getByRole('button', { name: 'Deploy', exact: true })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Build' })).toBeVisible()
  })
})

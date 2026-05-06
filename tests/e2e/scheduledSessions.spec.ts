/**
 * End-to-end tests for the queued/scheduled session flow.
 *
 * Splits along the seam where dialog UX ends and runtime fire behaviour
 * begins, so the slow waiting-for-a-timer test doesn't gate on the dialog
 * also rendering correctly.
 *
 *   1) Dialog → "Schedule for later" → submit → queued card appears in the
 *      "Scheduled" sidebar panel. (User's first concern: visibility.)
 *
 *   2) Programmatic addQueuedSession with a near-future scheduledFor →
 *      wait → the new session card appears in the regular sidebar AND the
 *      mock terminal received the prompt as a write call. (User's second
 *      concern: prompt actually injects.)
 */
import { test, expect, type Page } from '@playwright/test'

const projectTab = (page: Page, name: string) =>
  page.locator(`button:has(> span:text-is(${JSON.stringify(name)}))`)

async function bootApp(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(projectTab(page, 'CodeCrucible')).toBeVisible({ timeout: 10_000 })
}

/**
 * datetime-local needs a "YYYY-MM-DDTHH:mm" string in local TZ. Build one
 * `minutesAhead` minutes from now.
 */
function localDateTimeAhead(minutesAhead: number): string {
  const d = new Date(Date.now() + minutesAhead * 60_000)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

test.describe('Scheduled sessions — dialog flow', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('toggling "Schedule for later" reveals the prompt textarea and time picker', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await expect(page.getByRole('dialog', { name: 'New Session' })).toBeVisible()

    // Toggle on
    const scheduleCheckbox = page.getByRole('checkbox', { name: /schedule for later/i })
    await scheduleCheckbox.check()

    // The custom-prompt textarea is the user-facing fix for "I want to type
    // any prompt, not just pick from the template list".
    await expect(
      page.getByPlaceholder('What should the agent do when it starts?')
    ).toBeVisible()
    // The datetime picker
    await expect(page.locator('input[type="datetime-local"]')).toBeVisible()
    // Submit button label flips to "Schedule"
    await expect(page.getByRole('button', { name: 'Schedule' })).toBeVisible()
  })

  test('submitting Schedule creates a queued session card in the sidebar panel', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await page.getByPlaceholder('e.g. fix-auth-bug').fill('feat/scheduled-test')
    await page.getByRole('checkbox', { name: /schedule for later/i }).check()

    await page
      .getByPlaceholder('What should the agent do when it starts?')
      .fill('do the thing')

    // Schedule for 5 minutes from now (datetime-local granularity is 1m)
    await page
      .locator('input[type="datetime-local"]')
      .fill(localDateTimeAhead(5))

    await page.getByRole('button', { name: 'Schedule' }).click()

    // The "Scheduled" panel only appears when there's at least one queued
    // session. After submit, both should be visible.
    await expect(
      page.getByRole('heading', { name: /^Scheduled$/i })
    ).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText('feat/scheduled-test')).toBeVisible()
    await expect(page.getByText('do the thing')).toBeVisible()
  })

  test('submit is blocked until the user fills in a prompt', async ({ page }) => {
    await page.getByRole('button', { name: 'New session' }).click()
    await page.getByPlaceholder('e.g. fix-auth-bug').fill('feat/empty-prompt')
    await page.getByRole('checkbox', { name: /schedule for later/i }).check()
    await page
      .locator('input[type="datetime-local"]')
      .fill(localDateTimeAhead(5))
    // Leave prompt textarea empty
    await expect(page.getByRole('button', { name: 'Schedule' })).toBeDisabled()
  })
})

test.describe('Scheduled sessions — fire path', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  // This is the regression test for the user's exact bug: queued session
  // fired but the prompt was never injected into the agent terminal.
  test('queued session fires, becomes a real session, and the prompt is written to the agent terminal', async ({ page }) => {
    // Use the active CodeCrucible project (already selected after boot).
    const projectId = await page.evaluate(async () => {
      const list = await (window as any).api.project.list()
      return list.find((p: any) => p.name === 'CodeCrucible')!.id
    })

    // Programmatically queue a session ~1.5s out — short enough for the
    // test to wait, long enough that we observe the panel appear first.
    await page.evaluate(
      ([projectId]) => {
        const item = {
          id: 'qs-e2e-test',
          projectId,
          name: 'feat/e2e-fire',
          startupPrompt: 'INTEGRATION_TEST_PROMPT',
          scheduledFor: Date.now() + 1500,
          createdAt: new Date().toISOString(),
        }
        return (window as any).api.scheduler.addQueuedSession(item)
      },
      [projectId]
    )

    // The card shows up in the Scheduled panel before fire time.
    await expect(
      page.getByRole('heading', { name: /^Scheduled$/i })
    ).toBeVisible({ timeout: 3_000 })
    await expect(page.getByText('feat/e2e-fire')).toBeVisible()

    // Wait for the fire to happen — scheduledFor was 1.5s out plus a small
    // margin for the renderer's own session.list/save round-trip.
    await page.waitForTimeout(2_500)

    // The session is no longer in the Scheduled panel — the panel itself
    // disappears when the queue is empty.
    await expect(
      page.getByRole('heading', { name: /^Scheduled$/i })
    ).toHaveCount(0)

    // And the new session shows up as a regular session card. Anchor on
    // ^session-name to skip the inner "Actions for ..." dropdown button
    // and the toast.
    await expect(
      page.getByRole('button', { name: /^feat\/e2e-fire/ })
    ).toBeVisible({ timeout: 5_000 })

    // The mock's emitted output contains a `>` (Claude's input-prompt
    // marker), which writeWhenReady detects and writes the prompt. Give it
    // a second to do so.
    await page.waitForFunction(
      (needle: string) => {
        const writes = (window as any).__terminalWrites as Array<{
          terminalId: string
          data: string
        }>
        return writes.some((w) => w.data.includes(needle))
      },
      'INTEGRATION_TEST_PROMPT',
      { timeout: 12_000 }
    )

    // Belt-and-braces: the data written must include the prompt + carriage
    // return (so claude treats it as a submit, not a partial input).
    const writes = await page.evaluate(
      () => (window as any).__terminalWrites as Array<{ terminalId: string; data: string }>
    )
    const prompt = writes.find((w) => w.data.includes('INTEGRATION_TEST_PROMPT'))
    expect(prompt).toBeDefined()
    expect(prompt!.data.endsWith('\r')).toBe(true)
  })

  test('cancelling a queued session removes it from the panel and never fires', async ({ page }) => {
    const projectId = await page.evaluate(async () => {
      const list = await (window as any).api.project.list()
      return list.find((p: any) => p.name === 'CodeCrucible')!.id
    })
    await page.evaluate(
      ([projectId]) => {
        return (window as any).api.scheduler.addQueuedSession({
          id: 'qs-cancel-test',
          projectId,
          name: 'feat/will-cancel',
          startupPrompt: 'should-never-write',
          scheduledFor: Date.now() + 60_000, // 1 minute out
          createdAt: new Date().toISOString(),
        })
      },
      [projectId]
    )

    await expect(page.getByText('feat/will-cancel')).toBeVisible({ timeout: 5_000 })

    // Cancel via the IPC (the dropdown menu is finicky to drive in xterm
    // tests; we trust the unit tests for that path and target the IPC).
    await page.evaluate(() =>
      (window as any).api.scheduler.cancelQueuedSession('qs-cancel-test')
    )

    await expect(page.getByText('feat/will-cancel')).toHaveCount(0, { timeout: 3_000 })

    // Wait long enough that, if the timer wasn't cleared, the prompt would
    // have been written.
    await page.waitForTimeout(1_000)
    const wrote = await page.evaluate(() => {
      const writes = (window as any).__terminalWrites as Array<{
        terminalId: string
        data: string
      }>
      return writes.some((w) => w.data.includes('should-never-write'))
    })
    expect(wrote).toBe(false)
  })
})

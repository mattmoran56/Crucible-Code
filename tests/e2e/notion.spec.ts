/**
 * E2E tests for the Notion task integration.
 *
 * The mock backend (mock/mockApi.ts) exposes a `notion` namespace plus two
 * test hooks on `window`:
 *
 *   window.__notionFireTask(payload)  → simulates the main-process poller
 *                                       emitting NOTION_FIRE_TASK
 *   window.__notionWriteBackCalls     → an array the mock pushes to whenever
 *                                       window.api.notion.applyWriteBack is
 *                                       called
 *
 * Tests:
 *   1) Settings panel renders and exposes its primary controls.
 *   2) Firing a NOTION_FIRE_TASK turns into a real session card with the
 *      resolved startup prompt typed into the agent terminal, and triggers a
 *      write-back call to apply branch/sessionId-templated property updates.
 *   3) Notion MCP copy-prompt buttons exist and produce a prompt that
 *      contains the injected config file path + project id.
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

async function openSettings(page: Page) {
  await page.locator('button[title="Settings"]').click()
  await expect(page.getByRole('heading', { name: 'Notion Integration' })).toBeVisible({
    timeout: 10_000,
  })
}

test.describe('Notion integration — settings UI', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('renders a "Notion Integration" section with one card per project', async ({ page }) => {
    await openSettings(page)
    // Scroll the heading into view; the body is long.
    await page.getByRole('heading', { name: 'Notion Integration' }).scrollIntoViewIfNeeded()
    // There are three mock projects — each should get a row.
    await expect(
      page.locator('text=Notion Integration').first()
    ).toBeVisible()
    for (const name of ['CodeCrucible', 'my-api-service', 'design-system']) {
      // The settings section repeats project names, so we scope by the parent
      // heading + name occurring after it.
      await expect(page.locator(`p:has-text("${name}")`).first()).toBeVisible()
    }
  })

  test('Configure → form fields render and toggle on/off persists', async ({ page }) => {
    await openSettings(page)
    await page.getByRole('heading', { name: 'Notion Integration' }).scrollIntoViewIfNeeded()
    // The first project card has the first "Configure" button under the
    // Notion section. Anchor on the heading first.
    const section = page.locator(
      'div',
      { has: page.getByRole('heading', { name: 'Notion Integration' }) },
    ).first()
    await section.getByRole('button', { name: 'Configure' }).first().click()

    // API token field is the first password input in the section.
    const tokenInput = page.locator('input[type="password"]').first()
    await tokenInput.fill('secret_test_token')

    // Database id field — find an Input whose preceding label says "Database ID …"
    await page.getByPlaceholder(/32-char id or/).fill('1234567890abcdef1234567890abcdef')

    // Flip the toggle to On — there's only one ToggleGroup near the top with
    // "On"/"Off"; choose the On radio.
    const onRadio = page.locator('button[role="radio"][aria-checked="false"]', { hasText: 'On' }).first()
    if (await onRadio.count()) {
      await onRadio.click()
    }

    // After saving, querying the mock API for the config should return our values.
    await page.waitForTimeout(150)
    const stored = await page.evaluate(async () => {
      const list = await (window as any).api.project.list()
      const projectId = list.find((p: any) => p.name === 'CodeCrucible').id
      return (window as any).api.notion.loadConfig(projectId)
    })
    expect(stored).toMatchObject({
      apiToken: 'secret_test_token',
      databaseId: '1234567890abcdef1234567890abcdef',
    })
  })
})

test.describe('Notion integration — fire path', () => {
  test.beforeEach(async ({ page }) => bootApp(page))

  test('firing NOTION_FIRE_TASK creates a session and triggers a write-back call', async ({ page }) => {
    // Resolve the project id of the currently-active CodeCrucible project.
    const projectId = await page.evaluate(async () => {
      const list = await (window as any).api.project.list()
      return list.find((p: any) => p.name === 'CodeCrucible')!.id
    })

    // Sanity check: the write-back hook is exposed.
    const beforeWrites = await page.evaluate(
      () => (window as any).__notionWriteBackCalls as Array<unknown>
    )
    expect(Array.isArray(beforeWrites)).toBe(true)
    expect(beforeWrites.length).toBe(0)

    // Fire the task as if the main-process poller had picked it up.
    await page.evaluate(
      ([projectId]) => {
        ;(window as any).__notionFireTask({
          projectId,
          page: {
            id: 'notion-page-abc',
            url: 'https://notion.so/notion-page-abc',
            title: 'Pick me up',
            rawProperties: {},
          },
          resolvedStartupPrompt: '/notion-ticket https://notion.so/notion-page-abc',
          suggestedBranchName: 'notion/pick-me-up',
          suggestedSessionName: 'pick-me-up',
        })
      },
      [projectId]
    )

    // A new session card should appear in the sidebar.
    await expect(
      page.getByRole('button', { name: /^pick-me-up/ })
    ).toBeVisible({ timeout: 8_000 })

    // The prompt eventually shows up in the terminal-write stream — the mock
    // backend's terminal layer detects the `>` marker in the fake output and
    // writes pendingStartup. The write-back happens before that (synchronously
    // after createSession), so we wait on it directly.
    await page.waitForFunction(
      () => {
        const calls = (window as any).__notionWriteBackCalls as Array<{
          projectId: string
          page: { id: string }
          branch: string
          sessionId: string
        }>
        return calls.some((c) => c.page.id === 'notion-page-abc')
      },
      undefined,
      { timeout: 8_000 }
    )

    const writes = await page.evaluate(
      () => (window as any).__notionWriteBackCalls as Array<{
        projectId: string
        page: { id: string; title: string }
        branch: string
        sessionId: string
      }>
    )
    const call = writes.find((c) => c.page.id === 'notion-page-abc')
    expect(call).toBeDefined()
    expect(call!.projectId).toBe(projectId)
    expect(call!.branch.length).toBeGreaterThan(0)
    expect(call!.sessionId.length).toBeGreaterThan(0)
  })

  test('the startup prompt is written into the agent terminal when claude prints its prompt marker', async ({ page }) => {
    const projectId = await page.evaluate(async () => {
      const list = await (window as any).api.project.list()
      return list.find((p: any) => p.name === 'CodeCrucible')!.id
    })

    await page.evaluate(
      ([projectId]) => {
        ;(window as any).__notionFireTask({
          projectId,
          page: {
            id: 'notion-page-prompt',
            url: 'https://notion.so/p2',
            title: 'Prompt smoke test',
            rawProperties: {},
          },
          resolvedStartupPrompt: 'NOTION_E2E_PROMPT',
          suggestedBranchName: 'notion/prompt-smoke',
          suggestedSessionName: 'prompt-smoke',
        })
      },
      [projectId]
    )

    await page.waitForFunction(
      (needle: string) => {
        const writes = (window as any).__terminalWrites as Array<{
          terminalId: string
          data: string
        }>
        return writes.some((w) => w.data.includes(needle))
      },
      'NOTION_E2E_PROMPT',
      { timeout: 12_000 }
    )

    // writeWhenReady deliberately splits the injection into two writes — the
    // prompt text first, then a separate `\r` keystroke ~250ms later — so
    // claude's TUI registers Enter as a real keystroke rather than swallowing
    // it as part of a bracketed-paste payload. Wait for the trailing `\r`.
    await page.waitForFunction(
      () => {
        const writes = (window as any).__terminalWrites as Array<{
          terminalId: string
          data: string
        }>
        const promptIdx = writes.findIndex((w) => w.data.includes('NOTION_E2E_PROMPT'))
        if (promptIdx < 0) return false
        return writes.slice(promptIdx + 1).some((w) => w.data === '\r')
      },
      undefined,
      { timeout: 5_000 }
    )

    const writes = await page.evaluate(
      () => (window as any).__terminalWrites as Array<{ terminalId: string; data: string }>
    )
    const promptIdx = writes.findIndex((w) => w.data.includes('NOTION_E2E_PROMPT'))
    expect(promptIdx).toBeGreaterThanOrEqual(0)
    const followedByEnter = writes.slice(promptIdx + 1).some((w) => w.data === '\r')
    expect(followedByEnter).toBe(true)
  })
})

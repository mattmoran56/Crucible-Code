import { defineConfig, devices } from '@playwright/test'
import fs from 'fs'

const STORYBOOK_PORT = 6006
const MOCK_PORT = 5199

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? `http://localhost:${STORYBOOK_PORT}`
const MOCK_URL = process.env.MOCK_URL ?? `http://localhost:${MOCK_PORT}`

// Allow CI environments that pre-install browsers in a non-default location
// (e.g. our sandbox at /opt/pw-browsers) to work without Playwright trying to
// download a fresh copy.
const SYSTEM_CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
const useSystemChromium = !process.env.PLAYWRIGHT_CHROMIUM_DISABLE && fs.existsSync(SYSTEM_CHROMIUM)
const launchOptions = useSystemChromium ? { executablePath: SYSTEM_CHROMIUM } : undefined

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  // We expect snapshots to render the same byte-for-byte across runs on the
  // same OS, but rendering varies between platforms. Tolerate a small diff
  // for resilience without hiding real regressions.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    },
  },
  projects: [
    {
      name: 'screenshots',
      testDir: './tests/screenshots',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: STORYBOOK_URL,
        viewport: { width: 1280, height: 800 },
        launchOptions,
      },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: MOCK_URL,
        viewport: { width: 1280, height: 800 },
        launchOptions,
      },
    },
  ],
  // Auto-start the right server for each project
  webServer: [
    {
      command: 'npm run storybook -- --ci --quiet --no-open',
      port: STORYBOOK_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run mock -- --port 5199',
      port: MOCK_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
})

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1440, height: 1080 },
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chrome', use: { channel: 'chrome' } },
    { name: 'edge', use: { channel: 'msedge' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
  reporter: 'list',
})

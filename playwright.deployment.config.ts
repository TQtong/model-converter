import { defineConfig } from '@playwright/test'
import base from './playwright.config'

process.env.TEST_BASE_URL ??= 'http://127.0.0.1:4174/model-converter/'
export default defineConfig({
  ...base,
  testMatch: 'deployment.spec.ts',
  use: { ...base.use, baseURL: process.env.TEST_BASE_URL },
  webServer: {
    command: 'node scripts/serve-dist.mjs',
    url: process.env.TEST_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
})

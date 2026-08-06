import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3000)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Spread rather than `workers: undefined` — tsconfig sets exactOptionalPropertyTypes.
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI
    ? ([['github'], ['html', { open: 'never' }]] as const)
    : ([['list']] as const),

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // `08` §7 — RTL is tested from the first component, not at localization time.
    // The locale renders untranslated until Phase 7; the direction plumbing is what
    // is under test here.
    {
      name: 'chromium-rtl',
      use: {
        ...devices['Desktop Chrome'],
        locale: 'ar',
        extraHTTPHeaders: { 'Accept-Language': 'ar' },
      },
      grep: /@rtl/,
    },
  ],

  webServer: {
    command: 'pnpm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

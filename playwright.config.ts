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
    /**
     * Signs in once, before any worker starts, and caches the session for the admin-plane
     * specs (`tests/e2e/admin-session.setup.ts`).
     *
     * A project rather than a fixture because it has to be a barrier. Payload 3 tracks live
     * sessions on the user document, so concurrent logins as the same user invalidate each
     * other — authenticating per worker looked correct and logged six of seven workers out.
     */
    { name: 'admin-setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['admin-setup'],
    },
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
      dependencies: ['admin-setup'],
    },
  ],

  webServer: {
    command: 'pnpm run start',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

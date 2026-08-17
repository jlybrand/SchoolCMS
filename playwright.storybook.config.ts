import { defineConfig, devices } from '@playwright/test'

/**
 * The component-level axe gate (`06` §2.4, `07` §3).
 *
 * A separate config from `playwright.config.ts` because it needs a different server: the
 * public site (Postgres, seeded tenants, a Next build) versus Storybook (neither). Keeping
 * them apart means a component regression is diagnosable without standing up a database, and
 * the component gate keeps working in a phase where the page templates are still changing
 * shape.
 *
 * Storybook is served with `storybook dev` rather than a static build plus a file server:
 * one command, no extra dependency, and the story index is available on the same origin.
 */

const PORT = Number(process.env.STORYBOOK_PORT ?? 6006)
const baseURL = process.env.STORYBOOK_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/a11y',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,

  // Each spec walks every story in one direction, so the per-test budget covers the whole
  // story set rather than a single page.
  timeout: 300_000,

  reporter: process.env.CI
    ? ([['github'], ['html', { open: 'never' }]] as const)
    : ([['list']] as const),

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `pnpm exec storybook dev --port ${PORT} --ci --quiet`,
    url: `${baseURL}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
})

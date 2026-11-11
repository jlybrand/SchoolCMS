import { expect, test } from '@playwright/test'

import {
  LOGIN_PATH,
  adminCredentials,
  fillLoginForm,
  loginAsAdmin,
  submitLogin,
} from './support/admin-session'

/**
 * The seeded admin session itself, under test.
 *
 * This asserts a PREREQUISITE, not a feature: from Phase 3's paste normalizer onward, every
 * admin-plane flow needs an authenticated session, and CLAUDE.md's TDD exception table
 * requires those flows to be locked with a Playwright run. A session that quietly stops
 * working would make each of them fail for a reason that has nothing to do with what they
 * test, so it gets its own spec and fails on its own terms.
 *
 * Throws rather than skips when the credentials are missing in CI — see
 * `support/admin-session.ts`.
 */

const credentials = adminCredentials()

test.describe('district admin session', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  test('@smoke the seeded district admin can reach the admin plane', async ({ page }) => {
    // Room for loginAsAdmin's retries — it logs in fresh while the rest of the suite runs.
    test.slow()
    await loginAsAdmin(page, credentials!)

    // Reaching the dashboard is the assertion; asserting on its contents would pin
    // Payload's own UI, which is not ours and changes on version bumps.
    await expect(page).toHaveURL(/\/admin\/?$/)
  })

  test('admin tabs are named for DD2, not Payload (2026-11-11)', async ({ page }) => {
    await page.goto(LOGIN_PATH)
    await expect(page).toHaveTitle(/- DD2 Websites$/)
    await expect(page).not.toHaveTitle(/Payload/)
  })

  test('@smoke the admin plane is unreachable without a session', async ({ page }) => {
    /**
     * The other half of the same guarantee. A login helper that appears to work while
     * `/admin` is in fact open to anyone would pass the test above and prove nothing —
     * so prove the door is shut before proving the key opens it.
     */
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('@smoke a wrong password does not open the admin plane', async ({ page }) => {
    /**
     * Guards against the inverse false pass: if `loginAsAdmin` succeeded regardless of what
     * it typed, the seeded-credential path above would be measuring nothing.
     *
     * `maxLoginAttempts: 5` with a 10-minute lock (src/collections/Users.ts) is why this
     * spends exactly one attempt and no more.
     */
    await page.goto(LOGIN_PATH)
    // Same fill path as the real login, so this cannot pass by failing to type at all.
    await fillLoginForm(page, { email: credentials!.email, password: 'not-the-seeded-phrase' })
    await submitLogin(page)

    await expect(page).toHaveURL(/\/admin\/login/)
  })
})

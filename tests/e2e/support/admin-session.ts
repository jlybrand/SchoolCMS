import path from 'node:path'

import { expect, test as base, type Page } from '@playwright/test'

/**
 * Authenticated admin sessions for the e2e suite.
 *
 * ============================================================================
 * INTERIM POSTURE: this logs in with a password, which only exists because
 * local auth does (`02` §7, ADR-6 — see "Authentication" in CLAUDE.md). Under
 * Entra the form flow below is replaced by an OIDC redirect; the credentials
 * disappear and `loginAsAdmin` becomes the only file that changes.
 * ============================================================================
 *
 * WHY THIS IS NEEDED. Every admin-plane flow from here on — the paste normalizer's
 * heading prompt (`07` §4.2) first, the task plane and diff viewer in Phase 4 — is behind
 * `/admin`, and CLAUDE.md's TDD exception table makes a Playwright flow plus an axe
 * assertion the required lock-in for custom admin React. None of that can run without a
 * session, so the session is the prerequisite rather than part of the feature.
 *
 * WHY THE CREDENTIALS COME FROM THE ENVIRONMENT. `scripts/seed.ts` deliberately creates no
 * admin unless SEED_ADMIN_PASSWORD is set, so that no known credential ships in the repo.
 * That policy is not relaxed here — CI supplies its own throwaway pair for a database that
 * is destroyed with the runner (`.github/workflows/ci.yml`), and a developer opts in
 * locally via `.env`.
 */

export type AdminCredentials = { email: string; password: string }

const MISSING = `No seeded admin credentials.

The admin-plane e2e flows need a real session. Set both in .env (see .env.example):

  SEED_ADMIN_EMAIL=you@example.invalid
  SEED_ADMIN_PASSWORD=<at least 8 characters, see src/auth/password-policy.ts>

then re-run \`pnpm run seed\`. Nothing is seeded without them, on purpose: a known
credential committed to the repo is a standing vulnerability, and interim local auth
already carries enough credential risk.`

/**
 * The credentials, or `null` when none are configured.
 *
 * FAILS CLOSED IN CI, SKIPS LOCALLY. An unset variable on a developer's machine is a
 * missing opt-in and should skip; the same thing in CI means the gate silently stopped
 * covering the admin plane while still reporting green, which is the failure mode the axe
 * gate's fail-closed test exists to prevent. So CI throws instead.
 */
export const adminCredentials = (): AdminCredentials | null => {
  const email = process.env.SEED_ADMIN_EMAIL
  const password = process.env.SEED_ADMIN_PASSWORD

  if (email && password) return { email, password }
  if (process.env.CI) throw new Error(MISSING)
  return null
}

/** Payload's own login route. */
export const LOGIN_PATH = '/admin/login'

/**
 * Type credentials into Payload's login form.
 *
 * Located by label and role rather than by Payload's `#field-email` ids: those are internal
 * markup that a version bump may rename, and more to the point, a login form whose inputs
 * are not reachable by their accessible name is itself a defect this should surface. Both
 * admin planes enter the axe gate in Phase 4 (`07` §2) — this asserts reachability now, not
 * conformance.
 *
 * Fills and then asserts the value stuck, because the inputs are controlled and a `fill` that
 * lands before React mounts is discarded. That is necessary but NOT sufficient — see
 * `loginAsAdmin`, which retries the whole attempt.
 */
export const fillLoginForm = async (page: Page, credentials: AdminCredentials): Promise<void> => {
  const email = page.getByLabel(/email/i)
  const password = page.getByLabel(/password/i)

  await expect(async () => {
    await email.fill(credentials.email)
    await password.fill(credentials.password)
    await expect(email).toHaveValue(credentials.email, { timeout: 1_000 })
    await expect(password).toHaveValue(credentials.password, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/** Submit the login form. */
export const submitLogin = (page: Page): Promise<void> =>
  page.getByRole('button', { name: /log ?in/i }).click()

/**
 * Log in and land in the admin. Throws if the credentials do not work.
 *
 * THE WHOLE ATTEMPT RETRIES, not just the typing. Payload's login form is a client component
 * with controlled inputs, so a `fill` landing between first paint and hydration is discarded
 * when React mounts and re-renders from empty state; the form then submits blank and reports
 * both fields as required. Filling and re-reading the value does not close that window,
 * because the reset can arrive AFTER the read — which is how this passed with three workers
 * and failed with seven against a cold server. Reloading and trying again does close it: the
 * second attempt meets a hydrated form.
 *
 * A blank submit is not a failed credential attempt. Payload's client validation rejects an
 * empty email before it posts, and an unmatched email cannot increment the lockout counter on
 * `users` (`maxLoginAttempts: 5`), so a retry costs nothing but time.
 */
export const loginAsAdmin = async (page: Page, credentials: AdminCredentials): Promise<void> => {
  await expect(async () => {
    await page.goto(LOGIN_PATH)
    await fillLoginForm(page, credentials)
    await submitLogin(page)

    // Payload redirects to the admin dashboard on success and re-renders the form with an
    // error on failure, so leaving /login distinguishes the two without asserting on any
    // particular dashboard content.
    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 8_000 })
  }).toPass({ intervals: [250, 500, 1_000], timeout: 25_000 })

  await expect(page).toHaveURL(/\/admin/)
}

/**
 * Where the signed-in admin session is cached, written by `admin-session.setup.ts`.
 *
 * Gitignored. It holds a live `payload-token` for whatever database the run used, which is a
 * credential even when the database is a throwaway CI one.
 */
export const ADMIN_STORAGE_STATE = path.join('tests', '.auth', 'admin.json')

/**
 * A `test` that starts already signed in as the district admin.
 *
 * ONE LOGIN PER RUN, not per test and not per worker. Payload 3 puts a session id in the
 * token and tracks live sessions on the user document, so several concurrent logins as the
 * SAME user race on that list: the last write wins and the other tokens reference sessions
 * that no longer exist, which the admin answers by bouncing to the login screen. That is
 * exactly how seven parallel specs failed — every one of them authenticated successfully and
 * then found itself logged out.
 *
 * So the login happens once, in a setup project the real projects depend on
 * (`playwright.config.ts`), and every test here reuses the cookie it saved.
 *
 * `admin-session.spec.ts` deliberately does NOT use this: it tests logging in, and one of its
 * assertions is that an anonymous visit to `/admin` is refused. Handing it a session would
 * make that assertion impossible to write.
 */
export const adminTest = base.extend({ storageState: ADMIN_STORAGE_STATE })

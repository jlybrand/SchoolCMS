import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { test as setup } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, loginAsAdmin } from './support/admin-session'
import { ensureSchoolManager, SCHOOL_STORAGE_STATE } from './support/school-session'

/**
 * Signs in once per run and caches the session for every admin-plane spec.
 *
 * Runs as a setup project the real projects depend on, so it completes before any worker
 * starts. That ordering is the point: Payload 3 tracks live sessions on the user document, and
 * concurrent logins as the same user invalidate each other's tokens — see `adminTest` in
 * `support/admin-session.ts`.
 */
setup('authenticate the district admin and a school manager', async ({ browser, page }) => {
  mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true })

  const credentials = adminCredentials()

  /**
   * No credentials configured locally: write an ANONYMOUS state rather than failing. Every
   * spec that needs a session skips itself in that case (`adminCredentials` returns null), and
   * the public specs must still be runnable without one. In CI `adminCredentials` throws
   * instead, so a missing session there fails the run rather than quietly skipping it.
   */
  if (!credentials) {
    const anonymous = JSON.stringify({ cookies: [], origins: [] })
    writeFileSync(ADMIN_STORAGE_STATE, anonymous)
    writeFileSync(SCHOOL_STORAGE_STATE, anonymous)
    return
  }

  await loginAsAdmin(page, credentials)
  await page.context().storageState({ path: ADMIN_STORAGE_STATE })

  /**
   * The school manager, made by the admin just signed in (see `support/school-session.ts`),
   * then signed in once in a context of its own — a shared context would replace the admin's
   * cookie with theirs.
   */
  const school = await ensureSchoolManager(page.request)
  const schoolContext = await browser.newContext()
  const schoolPage = await schoolContext.newPage()
  await loginAsAdmin(schoolPage, school)
  await schoolContext.storageState({ path: SCHOOL_STORAGE_STATE })
  await schoolContext.close()
})

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { test as setup } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, loginAsAdmin } from './support/admin-session'

/**
 * Signs in once per run and caches the session for every admin-plane spec.
 *
 * Runs as a setup project the real projects depend on, so it completes before any worker
 * starts. That ordering is the point: Payload 3 tracks live sessions on the user document, and
 * concurrent logins as the same user invalidate each other's tokens — see `adminTest` in
 * `support/admin-session.ts`.
 */
setup('authenticate the district admin', async ({ page }) => {
  mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true })

  const credentials = adminCredentials()

  /**
   * No credentials configured locally: write an ANONYMOUS state rather than failing. Every
   * spec that needs a session skips itself in that case (`adminCredentials` returns null), and
   * the public specs must still be runnable without one. In CI `adminCredentials` throws
   * instead, so a missing session there fails the run rather than quietly skipping it.
   */
  if (!credentials) {
    writeFileSync(ADMIN_STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }))
    return
  }

  await loginAsAdmin(page, credentials)
  await page.context().storageState({ path: ADMIN_STORAGE_STATE })
})

import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { expect, test as base, type APIRequestContext } from '@playwright/test'

import type { AdminCredentials } from './admin-session'

/**
 * A signed-in school manager for the school-plane specs (`04` §2).
 *
 * MADE BY THE DISTRICT ADMIN, PER RUN, with a password nobody knows. The seed creates no
 * school-manager because a second known credential would be a second standing vulnerability
 * (see `admin-session.ts`); here the admin's own session creates the account through the
 * REST API — the same route district staff use — and resets its password to fresh random
 * bytes every run. Nothing is committed, and a password left in a local database from an
 * earlier run is useless.
 *
 * Interim-auth only, like `loginAsAdmin`: under Entra this becomes a test-tenant identity.
 */

export const SCHOOL_MANAGER_EMAIL = 'e2e-school-a@example.invalid'

/** The seeded tenant this manager works in. School B is the one they must never reach. */
export const SCHOOL_HOSTNAME = 'a.localhost'

/** Gitignored, beside the admin's — it holds a live `payload-token`. */
export const SCHOOL_STORAGE_STATE = path.join('tests', '.auth', 'school-manager.json')

export const tenantIdFor = async (request: APIRequestContext, hostname: string) => {
  const res = await request.get(
    `/api/tenants?where[hostname][equals]=${encodeURIComponent(hostname)}&limit=1&depth=0`,
  )
  expect(res.ok(), `tenant lookup for ${hostname}`).toBe(true)
  const [tenant] = (await res.json()).docs as { id: number }[]
  expect(tenant, `the seed creates ${hostname}`).toBeDefined()
  return tenant!.id
}

/**
 * Create the School A manager, or reset its password if it exists. Returns credentials for
 * this run. `request` must carry the district admin's session.
 */
export const ensureSchoolManager = async (
  request: APIRequestContext,
): Promise<AdminCredentials> => {
  const password = `e2e-${randomBytes(18).toString('base64url')}`
  const tenant = await tenantIdFor(request, SCHOOL_HOSTNAME)
  const data = { password, roles: ['school-manager'], tenants: [{ tenant }] }

  const found = await request.get(
    `/api/users?where[email][equals]=${encodeURIComponent(SCHOOL_MANAGER_EMAIL)}&limit=1&depth=0`,
  )
  expect(found.ok(), 'user lookup as the district admin').toBe(true)
  const [existing] = (await found.json()).docs as { id: number }[]

  const res = existing
    ? await request.patch(`/api/users/${existing.id}`, { data })
    : await request.post('/api/users', { data: { ...data, email: SCHOOL_MANAGER_EMAIL } })
  expect(res.ok(), `upsert school manager: ${res.status()} ${await res.text()}`).toBe(true)

  // A run that died mid-login can leave the account locked (`maxLoginAttempts: 5`).
  if (existing) await request.post(`/api/users/unlock`, { data: { email: SCHOOL_MANAGER_EMAIL } })

  return { email: SCHOOL_MANAGER_EMAIL, password }
}

/** A `test` that starts signed in as the School A manager. See `adminTest` for why one login. */
export const schoolTest = base.extend({ storageState: SCHOOL_STORAGE_STATE })

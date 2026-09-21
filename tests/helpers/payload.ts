import type { Payload, TypedUser } from 'payload'

import type { Role } from '@/access/types'

/**
 * Payload test harness for integration tests.
 *
 * Boots the REAL config against a disposable Postgres, so access control is exercised
 * through the actual stack rather than against a mock of it. That distinction matters here:
 * these tests are the tenant-isolation guarantee (`02` §4.2), and a suite that mocks the
 * thing it is guarding proves nothing.
 */

export const TEST_DATABASE_URI =
  process.env.TEST_DATABASE_URI ?? 'postgres:///dd2_test?host=/var/run/postgresql'

/**
 * Meets the interim local-auth policy (src/auth/password-policy.ts). Note it deliberately
 * avoids the word "password", which the policy rejects as a common fragment — the earlier
 * placeholder here failed its own check once the policy landed.
 */
export const SEED_PASSWORD = 'seed-otter-marble-91'

let cached: Payload | null = null

export async function getTestPayload(): Promise<Payload> {
  if (cached) return cached

  // Must be set before the config module is evaluated — it reads env at import time.
  process.env.DATABASE_URI = TEST_DATABASE_URI
  process.env.PAYLOAD_SECRET ??= 'test-only-secret-not-used-in-any-environment'

  const { getPayload } = await import('payload')
  const config = (await import('@payload-config')).default

  cached = await getPayload({ config })
  return cached
}

/**
 * Postgres issues serial (numeric) ids — see `Tenant['id']` in src/payload-types.ts.
 * The access layer normalizes ids to strings before comparing (`src/access/predicates.ts`)
 * precisely so this detail cannot leak into a security decision.
 */
export type Fixtures = {
  tenantA: number
  tenantB: number
  /** Page fixtures for the content-collection invariants (`03` §6.4 invariants 3–5). */
  publishedPageA: number
  draftPageA: number
  staffPageA: number
  publishedPageB: number
  /** One `navigation` row per school — the per-tenant record a school-manager may not touch. */
  navigationA: number
  navigationB: number
  /** One `theme` row per school, with different colours — same rule as the menus. */
  themeA: number
  themeB: number
  districtAdmin: TypedUser
  managerA: TypedUser
  managerB: TypedUser
  systemSync: TypedUser
  noTenantManager: TypedUser
}

/**
 * Deterministic seed, reset between runs (`06` §5): ≥3 tenants and a user per role,
 * including a school-manager assigned to NO tenant — the shape most likely to fail open.
 */
export async function seed(payload: Payload): Promise<Fixtures> {
  // Order matters: pages, navigation, theme and users all reference tenants.
  for (const collection of ['pages', 'navigation', 'theme', 'users', 'tenants'] as const) {
    await payload.delete({ collection, where: {}, overrideAccess: true })
  }

  const mk = async (name: string, slug: string, hostname: string, type: 'district' | 'school') =>
    (
      await payload.create({
        collection: 'tenants',
        data: { name, slug, hostname, type, status: 'active' },
        overrideAccess: true,
      })
    ).id as number

  /**
   * `*.localhost` hostnames, per the local/CI environment in `06` §4. The district is
   * mapped to bare `localhost` so the dev server and Playwright's readiness check resolve
   * to a real tenant — the proxy 404s an unknown Host by design (`02` §4.1), so without
   * this the server would never report ready.
   */
  const district = await mk('District', 'district', 'localhost', 'district')
  const tenantA = await mk('School A', 'school-a', 'a.localhost', 'school')
  const tenantB = await mk('School B', 'school-b', 'b.localhost', 'school')

  const mkUser = async (email: string, roles: Role[], tenants: number[]): Promise<TypedUser> =>
    (await payload.create({
      collection: 'users',
      data: {
        email,
        password: SEED_PASSWORD,
        name: email,
        roles,
        tenants: tenants.map((tenant) => ({ tenant })),
      },
      overrideAccess: true,
    })) as unknown as TypedUser

  const districtAdmin = await mkUser('district-admin@test.local', ['district-admin'], [district])

  /**
   * Pages spanning every axis the public and isolation rules turn on: status
   * (draft/published) and visibility (public/staff), across two tenants.
   *
   * CREATED AS THE DISTRICT ADMIN, and users are therefore seeded before pages. This is not
   * incidental: the publish gate is a `beforeChange` hook, and Payload runs hooks even when
   * `overrideAccess` is true. A publish with no actor at all is refused — correctly, since
   * "nobody" is not a role that may publish. Handing the fixtures a real actor keeps the
   * gate strict rather than teaching it an exception that production code could then use.
   */
  const mkPage = async (
    tenant: number,
    slug: string,
    status: 'draft' | 'published',
    visibility: 'public' | 'staff' = 'public',
  ): Promise<number> =>
    (
      await payload.create({
        collection: 'pages',
        data: {
          tenant,
          title: slug.replace(/-/g, ' '),
          slug,
          pageType: 'standard',
          visibility,
          _status: status,
        },
        user: districtAdmin,
        overrideAccess: true,
      })
    ).id as number

  /**
   * Menus that differ per tenant, so a leak reads as the WRONG school's links rather than as
   * a plausible menu. Each carries an external link, so the mapper's two kinds of destination
   * are both in the fixture.
   */
  const mkNavigation = async (tenant: number, name: string): Promise<number> =>
    (
      await payload.create({
        collection: 'navigation',
        data: {
          tenant,
          primary: [
            { label: `About ${name}`, href: '/about' },
            { label: 'Calendar', href: '/calendar' },
          ],
          utility: [{ label: 'Staff email', href: 'https://outlook.office.com', newTab: true }],
          footer: [{ label: `Contact ${name}`, href: '/contact' }],
        },
        overrideAccess: true,
      })
    ).id as number

  /** Both valid, and different, so a leak reads as the wrong school's colour. */
  const mkTheme = async (
    tenant: number,
    primaryColor: string,
    secondaryColor?: string,
  ): Promise<number> =>
    (
      await payload.create({
        collection: 'theme',
        data: { tenant, primaryColor, ...(secondaryColor ? { secondaryColor } : {}) },
        overrideAccess: true,
      })
    ).id as number

  return {
    tenantA,
    tenantB,
    // A has both colours and B only a main one, so the mapper's two shapes are both seeded.
    themeA: await mkTheme(tenantA, '#7a1f2b', '#c9a227'),
    themeB: await mkTheme(tenantB, '#14532d'),
    navigationA: await mkNavigation(tenantA, 'School A'),
    navigationB: await mkNavigation(tenantB, 'School B'),
    publishedPageA: await mkPage(tenantA, 'published-page-a', 'published'),
    draftPageA: await mkPage(tenantA, 'draft-page-a', 'draft'),
    staffPageA: await mkPage(tenantA, 'staff-page-a', 'published', 'staff'),
    publishedPageB: await mkPage(tenantB, 'published-page-b', 'published'),
    districtAdmin,
    managerA: await mkUser('manager-a@test.local', ['school-manager'], [tenantA]),
    managerB: await mkUser('manager-b@test.local', ['school-manager'], [tenantB]),
    systemSync: await mkUser('system-sync@test.local', ['system-sync'], [tenantA]),
    noTenantManager: await mkUser('no-tenant@test.local', ['school-manager'], []),
  }
}

/** Asserts a promise rejects — Payload throws Forbidden rather than returning a flag. */
export async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

/**
 * Asserts that a read yields NO documents, by either route Payload may take.
 *
 * When an access function returns `false` Payload throws Forbidden; when it returns a query
 * constraint that matches nothing it returns an empty list. Both are correct isolation, and
 * which one applies is Payload's implementation detail rather than our guarantee.
 *
 * The invariant we actually care about is "no rows reach the caller" (`03` §6.4), so that
 * is what this asserts — leaving the suite robust to Payload changing between the two on
 * upgrade, without weakening what it proves.
 */
export async function readsNothing(fn: () => Promise<{ docs: unknown[] }>): Promise<boolean> {
  try {
    const { docs } = await fn()
    return docs.length === 0
  } catch {
    return true
  }
}

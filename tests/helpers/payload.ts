import type { Payload, TypedUser } from 'payload'
import { sql } from '@payloadcms/db-postgres'

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
  /** The district's own tenant — where syndicated posts live (`02` §6). */
  districtTenant: number
  /** One "News" board per site, each in a folder named after the site (Jason, 2026-10-28). */
  boardDistrict: number
  boardA: number
  boardB: number
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
  /** One `theme` row per school, with different colors — same rule as the menus. */
  themeA: number
  themeB: number
  /** One `settings` row per school, with different details — same rule again. */
  settingsA: number
  settingsB: number
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
  // Order matters: pages, navigation, theme, settings and users all reference tenants.
  for (const collection of [
    // The staff directory (2026-11-13): a sync treats every person as the CSI feed's.
    'people',
    'staff-groups',
    // A site's file library (2026-11-13): files before the folders they sit in.
    'resources',
    'resource-folders',
    'events',
    'calendars',
    'posts',
    'post-boards',
    'post-folders',
    'post-tags',
    'pages',
    'navigation',
    'theme',
    'settings',
    'users',
    'tenants',
  ] as const) {
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

  /**
   * A school-manager with NO school — the shape most likely to fail open. Payload refuses to
   * create one (`src/access/user-school.ts`), so it is made with a school and the assignment
   * deleted underneath Payload: exactly the state of an account saved before that rule, or
   * written by anything that skips the hook. The access functions must still fail closed on
   * it; that is what this fixture is for.
   */
  const mkSchoollessManager = async (): Promise<TypedUser> => {
    const user = await mkUser('no-tenant@test.local', ['school-manager'], [tenantA])
    await payload.db.drizzle.execute(sql`delete from users_tenants where _parent_id = ${user.id}`)
    return (await payload.findByID({
      collection: 'users',
      id: user.id,
      overrideAccess: true,
    })) as unknown as TypedUser
  }

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
            { label: `About ${name}`, linkType: 'address', href: '/about' },
            { label: 'Calendar', linkType: 'address', href: '/calendar' },
          ],
          utility: [
            {
              label: 'Staff email',
              linkType: 'address',
              href: 'https://outlook.office.com',
              newTab: true,
            },
          ],
          footer: [{ label: `Contact ${name}`, linkType: 'address', href: '/contact' }],
        },
        overrideAccess: true,
      })
    ).id as number

  /** Both valid, and different, so a leak reads as the wrong school's color. */
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

  /** Different per tenant, so a leak reads as the wrong school's phone number. */
  const mkSettings = async (
    tenant: number,
    name: string,
    phone: string,
    on: ('es' | 'zhHans' | 'ko' | 'pt' | 'ar')[],
  ): Promise<number> =>
    (
      await payload.create({
        collection: 'settings',
        data: {
          tenant,
          siteTitle: `${name} School`,
          contact: { address: `1 ${name} Road\nSummerville, SC 29483`, phone },
          socialLinks: [{ platform: 'facebook', url: `https://www.facebook.com/${name}` }],
          defaultDescription: `About ${name}.`,
          enabledLocales: Object.fromEntries(
            (['es', 'zhHans', 'ko', 'pt', 'ar'] as const).map((field) => [
              field,
              on.includes(field),
            ]),
          ),
        },
        overrideAccess: true,
      })
    ).id as number

  /** A folder named after the site, holding a "News" board — the shape the seed script gives. */
  const mkBoard = async (tenant: number, folderName: string): Promise<number> => {
    const folder = await payload.create({
      collection: 'post-folders',
      data: { tenant, name: folderName },
      overrideAccess: true,
    })
    return (
      await payload.create({
        collection: 'post-boards',
        data: { tenant, folder: folder.id, name: 'News' },
        overrideAccess: true,
      })
    ).id as number
  }

  return {
    districtTenant: district,
    boardDistrict: await mkBoard(district, 'District'),
    boardA: await mkBoard(tenantA, 'School A'),
    boardB: await mkBoard(tenantB, 'School B'),
    tenantA,
    tenantB,
    // A serves two languages beside English and B none, so both ends of the list are seeded.
    settingsA: await mkSettings(tenantA, 'Alpha', '(843) 555-0101', ['es', 'ar']),
    settingsB: await mkSettings(tenantB, 'Bravo', '(843) 555-0202', []),
    // A has both colors and B only a main one, so the mapper's two shapes are both seeded.
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
    noTenantManager: await mkSchoollessManager(),
  }
}

export type PostFixtures = {
  publishedPostA: number
  draftPostA: number
  staffPostA: number
  publishedPostB: number
  /** The district's, shared with every school. */
  districtWidePost: number
  /** The district's, shared with every school — but never published. Must reach no one. */
  districtWideDraft: number
  /** The district's, shared with every school — but staff only. Must reach no public site. */
  districtWideStaffPost: number
  /** The district's, shared with School B only. */
  selectedForBPost: number
}

/**
 * Posts across every axis invariant 3 turns on (`03` §6.4): owner, status, visibility and
 * syndication scope. Separate from `seed` so the suites that count audit entries or pages are
 * unchanged by them; `seed` deletes them, so a fresh `seed` + `seedPosts` is a clean slate.
 *
 * Created as the district admin, for the reason `seed` gives for pages: the publish gate runs
 * even with access overridden.
 */
/** The fixture "News" board of a fixture tenant. */
export const boardFor = (f: Fixtures, tenant: number): number =>
  tenant === f.tenantA ? f.boardA : tenant === f.tenantB ? f.boardB : f.boardDistrict

export async function seedPosts(payload: Payload, f: Fixtures): Promise<PostFixtures> {
  const boardOf = (tenant: number) => boardFor(f, tenant)
  const mk = async (
    tenant: number,
    slug: string,
    status: 'draft' | 'published',
    {
      visibility = 'public',
      syndication,
    }: {
      visibility?: 'public' | 'staff'
      syndication?: { scope: 'this-tenant' | 'district-wide' | 'selected'; syndicatedTo?: number[] }
    } = {},
  ): Promise<number> =>
    (
      await payload.create({
        collection: 'posts',
        data: {
          tenant,
          board: boardOf(tenant),
          title: slug.replace(/-/g, ' '),
          slug,
          body: {
            root: {
              type: 'root',
              children: [{ type: 'paragraph', children: [{ type: 'text', text: slug }] }],
            },
          } as never,
          visibility,
          ...(syndication ? { syndication } : {}),
          _status: status,
        },
        user: f.districtAdmin,
        overrideAccess: true,
      })
    ).id as number

  const district = f.districtTenant
  return {
    publishedPostA: await mk(f.tenantA, 'published-post-a', 'published'),
    draftPostA: await mk(f.tenantA, 'draft-post-a', 'draft'),
    staffPostA: await mk(f.tenantA, 'staff-post-a', 'published', { visibility: 'staff' }),
    publishedPostB: await mk(f.tenantB, 'published-post-b', 'published'),
    districtWidePost: await mk(district, 'district-wide-post', 'published', {
      syndication: { scope: 'district-wide' },
    }),
    districtWideDraft: await mk(district, 'district-wide-draft', 'draft', {
      syndication: { scope: 'district-wide' },
    }),
    districtWideStaffPost: await mk(district, 'district-wide-staff', 'published', {
      visibility: 'staff',
      syndication: { scope: 'district-wide' },
    }),
    selectedForBPost: await mk(district, 'selected-for-b', 'published', {
      syndication: { scope: 'selected', syndicatedTo: [f.tenantB] },
    }),
  }
}

export type EventFixtures = {
  /** Each site's own calendar, made with the site (`makeMainCalendar`). */
  calendarA: number
  calendarB: number
  calendarDistrict: number
  /** A second district calendar, e.g. "District HS". */
  calendarDistrictHs: number
  publishedEventA: number
  draftEventA: number
  publishedEventB: number
  districtHsEvent: number
}

/** The site's own calendar, as `makeMainCalendar` made it. */
export const mainCalendarFor = async (payload: Payload, tenant: number): Promise<number> => {
  const { docs } = await payload.find({
    collection: 'calendars',
    where: { and: [{ tenant: { equals: tenant } }, { isMain: { equals: true } }] },
    limit: 1,
    overrideAccess: true,
  })
  if (!docs[0]) throw new Error(`tenant ${tenant} has no calendar of its own`)
  return docs[0].id as number
}

/**
 * Events across the axes the calendar rules turn on: owner, calendar and status. All on
 * 4 December 2026 at 6 p.m. local, so one range finds every one. Created as the district admin,
 * for the reason `seed` gives for pages.
 */
export async function seedEvents(payload: Payload, f: Fixtures): Promise<EventFixtures> {
  const calendarA = await mainCalendarFor(payload, f.tenantA)
  const calendarB = await mainCalendarFor(payload, f.tenantB)
  const calendarDistrict = await mainCalendarFor(payload, f.districtTenant)
  const calendarDistrictHs = (
    await payload.create({
      collection: 'calendars',
      data: { tenant: f.districtTenant, name: 'District HS' },
      overrideAccess: true,
    })
  ).id as number

  const mk = async (
    tenant: number,
    calendar: number,
    title: string,
    status: 'draft' | 'published',
  ): Promise<number> =>
    (
      await payload.create({
        collection: 'events',
        data: {
          tenant,
          calendar,
          title,
          start: '2026-12-04T23:00:00.000Z',
          location: 'Auditorium',
          _status: status,
        },
        user: f.districtAdmin,
        overrideAccess: true,
      })
    ).id as number

  return {
    calendarA,
    calendarB,
    calendarDistrict,
    calendarDistrictHs,
    publishedEventA: await mk(f.tenantA, calendarA, 'published event a', 'published'),
    draftEventA: await mk(f.tenantA, calendarA, 'draft event a', 'draft'),
    publishedEventB: await mk(f.tenantB, calendarB, 'published event b', 'published'),
    districtHsEvent: await mk(
      f.districtTenant,
      calendarDistrictHs,
      'district hs event',
      'published',
    ),
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

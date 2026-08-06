import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, isDenied, readsNothing, seed, type Fixtures } from '../helpers/payload'

/**
 * ADVERSARIAL TENANT-ISOLATION SUITE (`03` §6.4, `06` §2.2).
 *
 * ============================================================================
 * THIS SUITE IS THE ISOLATION GUARANTEE. IT IS NOT A SECONDARY CHECK.
 * ============================================================================
 *
 * v2.0 of the design placed tenant isolation in Postgres row-level security, where a
 * forgotten filter could not leak. Payload owns the connection and does not set per-request
 * session variables, so isolation reverted to application-layer access functions
 * (`02` §4.2). This suite is the only thing standing where RLS would have stood.
 *
 * Consequences, per `06` §intro and §7:
 *   - It runs on EVERY build. Never quarantined, never skipped, never marked flaky.
 *   - A failure here is release-blocking, not a warning.
 *   - It asserts denial INDEPENDENTLY of @payloadcms/plugin-multi-tenant, so that if the
 *     plugin changes behaviour on upgrade the tests fail loudly rather than isolation
 *     quietly weakening.
 *
 * Phase 1 proves invariants 1, 2 and 4 as far as the collections that exist allow.
 * Invariant 3 (syndicated published content is the only permitted cross-tenant read) and
 * invariant 5 (a school-manager cannot publish by any route) attach to content collections
 * and are asserted when those land in Phases 3 and 5.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

describe('invariant 1 — a user cannot READ another tenant', () => {
  it('school-manager A sees only tenant A', async () => {
    const { docs } = await payload.find({
      collection: 'tenants',
      user: f.managerA,
      overrideAccess: false,
    })
    expect(docs.map((d) => d.id)).toEqual([f.tenantA])
  })

  it('school-manager A cannot read tenant B by direct id', async () => {
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'tenants',
        id: f.tenantB,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a school-manager with NO tenant assignment reads nothing', async () => {
    // The shape most likely to fail open — an empty constraint that matches everything.
    expect(
      await readsNothing(() =>
        payload.find({
          collection: 'tenants',
          user: f.noTenantManager,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('an anonymous request reads nothing', async () => {
    expect(
      await readsNothing(() => payload.find({ collection: 'tenants', overrideAccess: false })),
    ).toBe(true)
  })

  it('district-admin reads across all tenants — cross-tenant BY DESIGN', async () => {
    const { docs } = await payload.find({
      collection: 'tenants',
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThanOrEqual(3)
  })

  it('a hand-crafted where clause cannot widen scope beyond the constraint', async () => {
    // The attack: ask for everything and hope the access constraint is replaced rather
    // than intersected with the caller's query.
    const { docs } = await payload.find({
      collection: 'tenants',
      user: f.managerA,
      where: { id: { not_equals: '' } },
      overrideAccess: false,
    })
    expect(docs.map((d) => d.id)).toEqual([f.tenantA])
  })

  it('sorting and pagination cannot surface another tenant', async () => {
    const { docs } = await payload.find({
      collection: 'tenants',
      user: f.managerA,
      sort: '-createdAt',
      limit: 100,
      page: 1,
      overrideAccess: false,
    })
    expect(docs.every((d) => d.id === f.tenantA)).toBe(true)
  })
})

describe('invariant 2 — a user cannot WRITE into another tenant', () => {
  it('school-manager A cannot update tenant B', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'tenants',
        id: f.tenantB,
        data: { name: 'HIJACKED' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)

    const still = await payload.findByID({
      collection: 'tenants',
      id: f.tenantB,
      overrideAccess: true,
    })
    expect(still.name).toBe('School B')
  })

  it('school-manager A cannot delete tenant B', async () => {
    const denied = await isDenied(() =>
      payload.delete({
        collection: 'tenants',
        id: f.tenantB,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)

    const still = await payload.findByID({
      collection: 'tenants',
      id: f.tenantB,
      overrideAccess: true,
    })
    expect(still.id).toBe(f.tenantB)
  })

  it('school-manager A cannot create a tenant', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'tenants',
        data: {
          name: 'Rogue',
          slug: 'rogue',
          hostname: 'rogue.district.test',
          type: 'school',
          status: 'active',
        },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a BULK update cannot reach another tenant', async () => {
    // `03` §6.4 requires denial across bulk operations, not just single-document routes —
    // bulk paths are where access checks are most often forgotten.
    await isDenied(() =>
      payload.update({
        collection: 'tenants',
        where: {},
        data: { name: 'BULK HIJACK' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const b = await payload.findByID({
      collection: 'tenants',
      id: f.tenantB,
      overrideAccess: true,
    })
    expect(b.name).toBe('School B')
  })

  it('a BULK delete cannot reach another tenant', async () => {
    await isDenied(() =>
      payload.delete({
        collection: 'tenants',
        where: {},
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const b = await payload.findByID({
      collection: 'tenants',
      id: f.tenantB,
      overrideAccess: true,
    })
    expect(b.id).toBe(f.tenantB)
  })

  it('an anonymous request cannot create', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'tenants',
        data: {
          name: 'Anon',
          slug: 'anon',
          hostname: 'anon.district.test',
          type: 'school',
          status: 'active',
        },
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })
})

describe('invariant 4 — the surface never leaks user records', () => {
  it('an anonymous request cannot list users', async () => {
    expect(
      await readsNothing(() => payload.find({ collection: 'users', overrideAccess: false })),
    ).toBe(true)
  })

  it('a school-manager sees only their OWN user record', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      user: f.managerA,
      overrideAccess: false,
    })
    expect(docs.map((d) => d.id)).toEqual([f.managerA.id])
  })

  it('a school-manager cannot read another user by direct id', async () => {
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'users',
        id: f.managerB.id,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('district-admin can enumerate users', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThanOrEqual(5)
  })
})

describe('privilege escalation — the user collection is all permissions', () => {
  it('a school-manager cannot grant themselves district-admin', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.managerA.id,
        data: { roles: ['district-admin'] },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)

    const still = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
    })
    expect(still.roles).toEqual(['school-manager'])
  })

  it('a school-manager cannot assign themselves another tenant', async () => {
    await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.managerA.id,
        data: { tenants: [{ tenant: f.tenantA }, { tenant: f.tenantB }] },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const still = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
      depth: 0,
    })
    const assigned = (still.tenants ?? []).map((t: { tenant: unknown }) => String(t.tenant))
    expect(assigned).toEqual([String(f.tenantA)])
  })

  it('a school-manager cannot grant themselves an auto-approve scope', async () => {
    /**
     * `04` §4.3 — auto-approval is off by default and is a district-admin's deliberate
     * statement about a named person. A self-grant would make the approval gate, which is
     * the platform's core accessibility control (`07` §1 layer 3), optional at the
     * editor's discretion.
     */
    await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.managerA.id,
        data: { autoApprove: ['posts:routine'] },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const still = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
    })
    expect(still.autoApprove ?? []).toEqual([])
  })

  it('auto-approve is EMPTY for every seeded user — no role or tenant defaults it', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      overrideAccess: true,
      limit: 100,
    })
    for (const user of docs) {
      expect(user.autoApprove ?? []).toEqual([])
    }
  })

  it('system-sync cannot escalate its own role', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.systemSync.id,
        data: { roles: ['district-admin'] },
        user: f.systemSync,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })
})

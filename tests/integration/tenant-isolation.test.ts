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
 * Phase 1 proved invariants 1, 2 and 4 as far as the collections that existed allowed.
 * Phase 3 adds `pages`, so invariant 5 — a school-manager cannot publish BY ANY ROUTE — is
 * asserted here for the first time, against the real stack rather than against the access
 * functions in isolation (those have their own suite in tests/unit/access/pages.test.ts).
 *
 * Invariant 3 (syndicated published content is the only permitted cross-tenant read)
 * attaches to `posts` and `events` and lands with them in Phase 5.
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

describe('pages — invariant 1 extended to content', () => {
  it("school-manager B cannot read tenant A's draft page", async () => {
    // A draft is the most sensitive thing a content collection holds: unreviewed content,
    // visible to no one outside the tenant (`03` §6.4 invariant 1).
    const denied = await isDenied(() =>
      payload.findByID({
        collection: 'pages',
        id: f.draftPageA,
        user: f.managerB,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it("school-manager A lists only their own tenant's pages", async () => {
    const { docs } = await payload.find({
      collection: 'pages',
      user: f.managerA,
      draft: true,
      limit: 100,
      // depth 0 so `tenant` is the id rather than a populated document — comparing against
      // a populated object stringifies to "[object Object]" and passes for ANY tenant.
      depth: 0,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => String(d.tenant) === String(f.tenantA))).toBe(true)
    // Named explicitly, so a regression reads as "B leaked into A's list".
    expect(docs.map((d) => Number(d.id))).not.toContain(f.publishedPageB)
  })

  it('system-sync reads NO pages at all — it owns none', async () => {
    /**
     * `03` §6.1 and `11`: the sync actor touches `people` source-owned fields in mapped
     * tenants and nothing else. Reusing the generic tenant-scoped read would have handed it
     * a constraint over pages instead of a flat denial.
     */
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'pages', user: f.systemSync, overrideAccess: false }),
      ),
    ).toBe(true)
  })
})

describe('pages — invariant 4: the public surface', () => {
  it('an anonymous read returns published, public pages ONLY', async () => {
    const { docs } = await payload.find({
      collection: 'pages',
      limit: 100,
      overrideAccess: false,
    })

    const ids = docs.map((d) => Number(d.id))
    expect(ids).toContain(f.publishedPageA)
    // The two that must never appear.
    expect(ids).not.toContain(f.draftPageA)
    expect(ids).not.toContain(f.staffPageA)
  })

  it('an anonymous request cannot fetch a draft by direct id', async () => {
    const denied = await isDenied(() =>
      payload.findByID({ collection: 'pages', id: f.draftPageA, overrideAccess: false }),
    )
    expect(denied).toBe(true)
  })

  it('an anonymous request cannot fetch a staff-only page by direct id', async () => {
    const denied = await isDenied(() =>
      payload.findByID({ collection: 'pages', id: f.staffPageA, overrideAccess: false }),
    )
    expect(denied).toBe(true)
  })

  it('a hand-crafted where clause cannot surface a draft', async () => {
    // The attack: ask for drafts explicitly and hope the public constraint is replaced
    // rather than intersected.
    const { docs } = await payload.find({
      collection: 'pages',
      where: { _status: { equals: 'draft' } },
      limit: 100,
      overrideAccess: false,
    })
    expect(docs).toHaveLength(0)
  })
})

describe('invariant 5 — a school-manager cannot PUBLISH by any route', () => {
  /**
   * ==========================================================================
   * RELEASE-BLOCKING (CLAUDE.md rule 3, `03` §6.4 invariant 5, `05`).
   * Every route Payload offers is exercised here, because "cannot publish"
   * is only true if it is true everywhere.
   * ==========================================================================
   */

  it('cannot create a page already marked published', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'pages',
        data: {
          tenant: f.tenantA,
          title: 'Sneaky',
          slug: 'sneaky',
          pageType: 'standard',
          visibility: 'public',
          _status: 'published',
        },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)

    // And nothing landed — a denial that still wrote the row would be worse than no gate.
    const { docs } = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'sneaky' } },
      draft: true,
      overrideAccess: true,
    })
    expect(docs).toHaveLength(0)
  })

  it('cannot update their own draft to published', async () => {
    const denied = await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.draftPageA,
        data: { _status: 'published' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still._status).toBe('draft')
  })

  it('cannot publish via a BULK update', async () => {
    /**
     * The route a per-document gate misses. `05` names bulk operations explicitly, because
     * a where-clause update does not carry the same payload shape as a single write.
     */
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        where: { tenant: { equals: f.tenantA } },
        data: { _status: 'published' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still._status).toBe('draft')
  })

  it('cannot schedule a publish with publishAt', async () => {
    // A deferred publish is a publish. Leaving this open lets a school-manager publish by
    // waiting.
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.draftPageA,
        data: { publishAt: '2026-09-01T00:00:00.000Z' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still.publishAt ?? null).toBeNull()
    expect(still._status).toBe('draft')
  })

  it('CAN still save a draft — the gate blocks publishing, not working', async () => {
    /**
     * The other half of the guarantee, and the one that makes the platform usable: a school
     * manager edits freely and submits for approval (`04` §5). A gate that also blocked
     * ordinary editing would be a bug, not extra safety.
     */
    const updated = await payload.update({
      collection: 'pages',
      id: f.draftPageA,
      data: { title: 'Edited by the school' },
      user: f.managerA,
      overrideAccess: false,
    })
    expect(updated.title).toBe('Edited by the school')
    expect(updated._status).toBe('draft')
  })

  it('district-admin CAN publish — the gate is about role, not about the action', async () => {
    const published = await payload.update({
      collection: 'pages',
      id: f.draftPageA,
      data: { _status: 'published' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(published._status).toBe('published')
  })
})

describe('composed pages are district-only (`03` §2–3)', () => {
  it('a school-manager cannot create a composed page', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'pages',
        data: {
          tenant: f.tenantA,
          title: 'Composed attempt',
          slug: 'composed-attempt',
          pageType: 'composed',
          visibility: 'public',
        },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a school-manager cannot convert an existing page to composed', async () => {
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.draftPageA,
        data: { pageType: 'composed' },
        user: f.managerA,
        overrideAccess: false,
      }),
    )

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still.pageType).toBe('standard')
  })

  it('district-admin can create a composed page', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'District composed',
        slug: 'district-composed',
        pageType: 'composed',
        visibility: 'public',
      },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(page.pageType).toBe('composed')
  })
})

describe('sibling slugs stay unique within a parent', () => {
  it('rejects a second top-level page with an existing slug in the same tenant', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'pages',
        data: {
          tenant: f.tenantA,
          title: 'Duplicate',
          slug: 'published-page-a',
          pageType: 'standard',
          visibility: 'public',
        },
        overrideAccess: true,
      }),
    )
    expect(denied).toBe(true)
  })

  it('ALLOWS the same slug in a different tenant', async () => {
    // Every school may have an /about. Scoping the uniqueness check by tenant is what makes
    // 28 sites from one collection work at all.
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantB,
        title: 'Published page a',
        slug: 'published-page-a',
        pageType: 'standard',
        visibility: 'public',
      },
      overrideAccess: true,
    })
    expect(page.slug).toBe('published-page-a')
  })
})

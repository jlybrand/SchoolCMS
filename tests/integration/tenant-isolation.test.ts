import { createLocalReq, type Payload } from 'payload'
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
        data: { autoApprove: ['posts.routine'] },
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

  it("a school-manager cannot change anyone's district-alert setting", async () => {
    // Mail, not permission — but turning a district admin's alerts off is still the district's
    // call, and a school that silenced the queue's alerts could let a submission sit unseen.
    for (const id of [f.managerA.id, f.districtAdmin.id]) {
      await isDenied(() =>
        payload.update({
          collection: 'users',
          id,
          data: { receivesAlerts: false },
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      const still = await payload.findByID({ collection: 'users', id, overrideAccess: true })
      expect(still.receivesAlerts).toBe(true)
    }
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

describe('page history is district-only (Jason, 2026-10-27)', () => {
  /**
   * A school manager neither lists past versions nor restores one. Restore is the route that
   * matters: Payload checks it against UPDATE access, which a school manager holds for their
   * own pages, so it is refused in `src/collections/hooks/page-history.ts` — on their OWN
   * school's page, which is the case tenant isolation does not cover.
   */
  let pageId: number
  let oldDraftId: string
  let publishedId: string

  const versionsOf = async (id: number) =>
    (
      await payload.findVersions({
        collection: 'pages',
        where: { parent: { equals: id } },
        sort: 'createdAt',
        pagination: false,
        overrideAccess: true,
      })
    ).docs

  const latestTitle = async () =>
    (await payload.findByID({ collection: 'pages', id: pageId, draft: true, overrideAccess: true }))
      .title

  beforeAll(async () => {
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'History v1',
        slug: 'history-page',
        pageType: 'standard',
        visibility: 'public',
        _status: 'published',
      },
      // The publish gate refuses a userless publish, so the district makes the page.
      user: f.districtAdmin,
      overrideAccess: true,
    })
    pageId = page.id
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { title: 'History v2 draft' },
      draft: true,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { title: 'History v3 current' },
      draft: true,
      overrideAccess: true,
    })
    const versions = await versionsOf(pageId)
    publishedId = String(versions.find((v) => v.version._status === 'published')!.id)
    oldDraftId = String(versions.find((v) => v.version.title === 'History v2 draft')!.id)
  })

  it('a school manager cannot list versions of their own page', async () => {
    const denied = await isDenied(() =>
      payload.findVersions({
        collection: 'pages',
        where: { parent: { equals: pageId } },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a school manager cannot open one version or count them', async () => {
    expect(
      await isDenied(() =>
        payload.findVersionByID({
          collection: 'pages',
          id: oldDraftId,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    expect(
      await isDenied(() =>
        payload.countVersions({
          collection: 'pages',
          where: { parent: { equals: pageId } },
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it.each([
    ['an older draft', () => oldDraftId],
    ['the published version', () => publishedId],
  ])('a school manager cannot restore %s of their own page', async (_label, versionId) => {
    for (const draft of [true, false]) {
      const denied = await isDenied(() =>
        payload.restoreVersion({
          collection: 'pages',
          id: versionId(),
          draft,
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      expect(denied).toBe(true)
    }
    expect(await latestTitle()).toBe('History v3 current')
  })

  it('the sync account cannot restore either', async () => {
    const denied = await isDenied(() =>
      payload.restoreVersion({
        collection: 'pages',
        id: oldDraftId,
        draft: true,
        user: f.systemSync,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a school manager still opens and edits their own draft', async () => {
    const draft = await payload.findByID({
      collection: 'pages',
      id: pageId,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(draft.title).toBe('History v3 current')
  })

  it('a district admin lists versions and restores one', async () => {
    const { docs } = await payload.findVersions({
      collection: 'pages',
      where: { parent: { equals: pageId } },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThanOrEqual(3)

    await payload.restoreVersion({
      collection: 'pages',
      id: oldDraftId,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await latestTitle()).toBe('History v2 draft')
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

describe('navigation — district-only, one row per tenant (`03` §5, §6.1)', () => {
  /**
   * `03` §6.1: a school-manager "cannot touch theme, navigation…". That is stricter than
   * tenant scoping — a manager is refused their OWN school's menus as well as another's — so
   * every case below is run against both tenants, and the own-tenant half is the one a
   * tenant-scoped access function would have got wrong.
   */
  const rows = () =>
    [
      ['their own', f.navigationA],
      ["another tenant's", f.navigationB],
    ] as const

  it('a school-manager reads no menus at all, by list or by id', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'navigation', user: f.managerA, overrideAccess: false }),
      ),
    ).toBe(true)

    for (const [, id] of rows()) {
      const denied = await isDenied(() =>
        payload.findByID({
          collection: 'navigation',
          id,
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      expect(denied).toBe(true)
    }
  })

  it("a school-manager cannot UPDATE menus — their own or anyone else's", async () => {
    for (const [, id] of rows()) {
      const denied = await isDenied(() =>
        payload.update({
          collection: 'navigation',
          id,
          data: { primary: [{ label: 'Hijacked', href: 'https://evil.example' }] },
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      expect(denied).toBe(true)
    }

    // Denial is only half of it: the rows are unchanged.
    const { docs } = await payload.find({
      collection: 'navigation',
      overrideAccess: true,
      limit: 100,
    })
    expect(JSON.stringify(docs)).not.toContain('Hijacked')
  })

  it('a school-manager cannot DELETE menus', async () => {
    for (const [, id] of rows()) {
      const denied = await isDenied(() =>
        payload.delete({ collection: 'navigation', id, user: f.managerA, overrideAccess: false }),
      )
      expect(denied).toBe(true)
    }
  })

  it('a school-manager cannot CREATE menus, even for a tenant with none', async () => {
    const { docs } = await payload.find({
      collection: 'tenants',
      where: { slug: { equals: 'district' } },
      overrideAccess: true,
    })
    const district = docs[0]?.id
    if (district === undefined) throw new Error('fixture district tenant is missing')

    const denied = await isDenied(() =>
      payload.create({
        collection: 'navigation',
        data: { tenant: district, primary: [{ label: 'About', href: '/about' }] },
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('system-sync and anonymous callers read nothing', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'navigation', user: f.systemSync, overrideAccess: false }),
      ),
    ).toBe(true)
    // No anonymous grant: the public site reads through `src/content/*`, never the API.
    expect(
      await readsNothing(() => payload.find({ collection: 'navigation', overrideAccess: false })),
    ).toBe(true)
  })

  it("the district admin edits any tenant's menus", async () => {
    const updated = await payload.update({
      collection: 'navigation',
      id: f.navigationB,
      data: { footer: [{ label: 'Contact School B', href: '/contact' }] },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(updated.footer?.[0]?.label).toBe('Contact School B')
  })

  it('a tenant has ONE set of menus — a second row is refused, even for the district admin', async () => {
    /**
     * The database's refusal, not a hook's: `isGlobal` makes `tenant` unique. Two rows would
     * leave `getNavigation` choosing between them, and which one it chose would be cached.
     */
    const denied = await isDenied(() =>
      payload.create({
        collection: 'navigation',
        data: { tenant: f.tenantA, primary: [{ label: 'Second', href: '/second' }] },
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('refuses an unsafe destination by every route the admin would not', async () => {
    for (const href of ['javascript:alert(1)', '//evil.example', 'about']) {
      const denied = await isDenied(() =>
        payload.update({
          collection: 'navigation',
          id: f.navigationA,
          data: { primary: [{ label: 'Bad', href }] },
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      )
      expect(denied).toBe(true)
    }
  })
})

describe('theme — district-only, one row per tenant, never a failing palette (`03` §5, `07` §3)', () => {
  // As for navigation: a manager is refused their OWN school's row too, so both are tried.
  const rows = () =>
    [
      ['their own', f.themeA],
      ["another tenant's", f.themeB],
    ] as const

  it('a school-manager reads no theme at all, by list or by id', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'theme', user: f.managerA, overrideAccess: false }),
      ),
    ).toBe(true)

    for (const [, id] of rows()) {
      const denied = await isDenied(() =>
        payload.findByID({ collection: 'theme', id, user: f.managerA, overrideAccess: false }),
      )
      expect(denied).toBe(true)
    }
  })

  it("a school-manager cannot UPDATE or DELETE a theme — their own or anyone else's", async () => {
    for (const [, id] of rows()) {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'theme',
            id,
            data: { primaryColor: '#000000' },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.delete({ collection: 'theme', id, user: f.managerA, overrideAccess: false }),
        ),
      ).toBe(true)
    }

    const { docs } = await payload.find({ collection: 'theme', overrideAccess: true })
    expect(docs.map((doc) => doc.primaryColor).sort()).toEqual(['#14532d', '#7a1f2b'])
  })

  it('system-sync and anonymous callers read nothing', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'theme', user: f.systemSync, overrideAccess: false }),
      ),
    ).toBe(true)
    expect(
      await readsNothing(() => payload.find({ collection: 'theme', overrideAccess: false })),
    ).toBe(true)
  })

  it('a tenant has ONE theme — a second row is refused, even for the district admin', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'theme',
        data: { tenant: f.tenantA, primaryColor: '#000000' },
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('refuses a colour that fails contrast — through the API, not just the admin form', async () => {
    /**
     * `07` §3: "a school cannot pick a brand colour that fails". The district admin is the
     * only actor who can write here, so the district admin is who the check has to stop.
     */
    for (const primaryColor of ['#ffcc00', '#767676', 'navy', '#0f4c81;background:red']) {
      const denied = await isDenied(() =>
        payload.update({
          collection: 'theme',
          id: f.themeA,
          data: { primaryColor },
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      )
      expect(denied, primaryColor).toBe(true)
    }
  })

  it('takes a light colour as the SECOND colour — and still refuses one that is not a colour', async () => {
    // The same gold the main colour refuses above. It is decorative here (`src/lib/theme.ts`).
    const updated = await payload.update({
      collection: 'theme',
      id: f.themeA,
      data: { secondaryColor: '#FFCC00' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(updated.secondaryColor).toBe('#ffcc00')

    for (const secondaryColor of ['gold', '#ffcc00;background:red']) {
      const denied = await isDenied(() =>
        payload.update({
          collection: 'theme',
          id: f.themeA,
          data: { secondaryColor },
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      )
      expect(denied, secondaryColor).toBe(true)
    }
  })

  it('stores one spelling per colour, and lets the district admin clear it', async () => {
    const updated = await payload.update({
      collection: 'theme',
      id: f.themeB,
      data: { primaryColor: ' #123 ' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(updated.primaryColor).toBe('#112233')

    // Empty means "the district's blue" — a theme can always be taken back off.
    const cleared = await payload.update({
      collection: 'theme',
      id: f.themeB,
      data: { primaryColor: null },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(cleared.primaryColor ?? null).toBeNull()
  })
})

describe('settings — district-only, one row per tenant (`03` §5, §6.1)', () => {
  // As for navigation and theme: a manager is refused their OWN school's row too.
  const rows = () =>
    [
      ['their own', f.settingsA],
      ["another tenant's", f.settingsB],
    ] as const

  it('a school-manager reads no settings at all, by list or by id', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'settings', user: f.managerA, overrideAccess: false }),
      ),
    ).toBe(true)

    for (const [, id] of rows()) {
      const denied = await isDenied(() =>
        payload.findByID({ collection: 'settings', id, user: f.managerA, overrideAccess: false }),
      )
      expect(denied).toBe(true)
    }
  })

  it("a school-manager cannot CREATE, UPDATE or DELETE settings — their own or anyone else's", async () => {
    for (const [, id] of rows()) {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'settings',
            id,
            // The write with teeth: turning a language off is a language-access decision.
            data: { enabledLocales: { es: false, ar: false } },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.delete({ collection: 'settings', id, user: f.managerA, overrideAccess: false }),
        ),
      ).toBe(true)
    }

    // The district tenant has no row, so this is refused on access, not on uniqueness.
    const { docs: tenants } = await payload.find({
      collection: 'tenants',
      where: { type: { equals: 'district' } },
      overrideAccess: true,
    })
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'settings',
          data: { tenant: tenants[0]!.id, siteTitle: 'Mine now' },
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)

    const { docs } = await payload.find({
      collection: 'settings',
      sort: 'siteTitle',
      overrideAccess: true,
    })
    expect(
      docs.map((doc) => [doc.siteTitle, doc.enabledLocales?.es, doc.enabledLocales?.ar]),
    ).toEqual([
      ['Alpha School', true, true],
      ['Bravo School', false, false],
    ])
  })

  it('system-sync and anonymous callers read nothing', async () => {
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'settings', user: f.systemSync, overrideAccess: false }),
      ),
    ).toBe(true)
    expect(
      await readsNothing(() => payload.find({ collection: 'settings', overrideAccess: false })),
    ).toBe(true)
  })

  it('a tenant has ONE settings row — a second is refused, even for the district admin', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'settings',
        data: { tenant: f.tenantA, siteTitle: 'A second one' },
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('refuses a destination that is not one — through the API, not just the admin form', async () => {
    const bad = [
      { contact: { phone: 'call the office' } },
      { contact: { email: 'office@dd2.example?bcc=someone@else.example' } },
      { socialLinks: [{ platform: 'facebook' as const, url: 'javascript:alert(1)' }] },
      { socialLinks: [{ platform: 'facebook' as const, url: 'http://www.facebook.com/dd2' }] },
    ]

    for (const data of bad) {
      const denied = await isDenied(() =>
        payload.update({
          collection: 'settings',
          id: f.settingsA,
          data,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      )
      expect(denied, JSON.stringify(data)).toBe(true)
    }
  })

  it('the district admin can change them, and can empty a field back out', async () => {
    const updated = await payload.update({
      collection: 'settings',
      id: f.settingsB,
      data: { contact: { phone: '843.555.0299', email: null }, enabledLocales: { es: true } },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(updated.contact?.phone).toBe('843.555.0299')
    // One box ticked; the others keep the answer they had.
    expect(updated.enabledLocales).toMatchObject({ es: true, ar: false })
  })
})

describe('page SEO fields ride the same gates as the page (`04` §4.3)', () => {
  it('a school-manager may propose SEO text on a draft in their own tenant', async () => {
    const updated = await payload.update({
      collection: 'pages',
      id: f.draftPageA,
      data: { meta: { description: 'Proposed by the school.' } },
      user: f.managerA,
      draft: true,
      overrideAccess: false,
    })
    expect(updated.meta?.description).toBe('Proposed by the school.')
    // Still a draft: writing SEO text is not a route to publishing (invariant 5).
    expect(updated._status).toBe('draft')
  })

  it("cannot write another tenant's, and cannot publish by way of it", async () => {
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'pages',
          id: f.publishedPageB,
          data: { meta: { title: 'Hijacked' } },
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)

    expect(
      await isDenied(() =>
        payload.update({
          collection: 'pages',
          id: f.draftPageA,
          data: { meta: { title: 'Live now' }, _status: 'published' },
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
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

/**
 * The jobs queue (`src/jobs/`) is a second way into the platform's data: a job runs as the
 * platform, and Payload's own defaults leave it wide open — the run endpoint's fallback is
 * `() => true` (anyone, signed in or not) and the `payload-jobs` collection takes the default
 * "any signed-in user". Nobody but the district may trigger, queue, cancel or read a job.
 */
describe('the jobs queue is district-only', () => {
  const access = () => payload.config.jobs.access ?? {}

  const queueOne = () =>
    payload.jobs.queue({ task: 'districtDigest', input: {}, waitUntil: new Date('2099-01-01') })

  it.each([
    ['run', () => access().run],
    ['queue', () => access().queue],
    ['cancel', () => access().cancel],
  ] as const)('only a district admin may %s jobs', async (_name, fn) => {
    const check = fn()
    expect(check).toBeTypeOf('function')
    const as = async (user: unknown) =>
      Boolean(
        await check!({ req: await createLocalReq({ user: user as never }, payload) } as never),
      )
    expect(await as(f.districtAdmin)).toBe(true)
    expect(await as(f.managerA)).toBe(false)
    expect(await as(f.systemSync)).toBe(false)
    expect(await as(undefined)).toBe(false)
  })

  it('a school-manager cannot read the jobs table', async () => {
    await queueOne()
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'payload-jobs', user: f.managerA, overrideAccess: false }),
      ),
    ).toBe(true)
  })

  it('an anonymous request cannot read the jobs table', async () => {
    await queueOne()
    expect(
      await readsNothing(() => payload.find({ collection: 'payload-jobs', overrideAccess: false })),
    ).toBe(true)
  })

  it('a school-manager cannot write a job directly into the table', async () => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'payload-jobs',
        data: { taskSlug: 'districtDigest', input: {} } as never,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    expect(denied).toBe(true)
  })

  it('a school-manager cannot delete queued jobs', async () => {
    const job = await queueOne()
    await isDenied(() =>
      payload.delete({
        collection: 'payload-jobs',
        where: {},
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    const still = await payload.findByID({
      collection: 'payload-jobs',
      id: job.id,
      overrideAccess: true,
      disableErrors: true,
    })
    expect(still).not.toBeNull()
  })
})

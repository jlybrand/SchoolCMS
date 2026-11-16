import { createLocalReq, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { listEventOccurrences } from '@/content/events'
import { listPosts } from '@/content/posts'
import type { ContentContext } from '@/content/types'

import {
  getTestPayload,
  isDenied,
  readsNothing,
  seed,
  seedPosts,
  seedEvents,
  boardFor,
  type EventFixtures,
  type Fixtures,
  type PostFixtures,
} from '../helpers/payload'
import { tinyPng } from '../helpers/files'

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
 * Invariant 3 (syndicated published content is the only permitted cross-tenant read) lands
 * with `posts` in Phase 5 — the `posts` describe blocks at the end of this file.
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

  it('cannot hide a page from navigation, site search or search engines', async () => {
    // The district's page options (Jason, 2026-10-29). Field access drops the write silently,
    // as Payload does for any field a user may not update; the value is what proves it.
    await payload
      .update({
        collection: 'pages',
        id: f.draftPageA,
        data: { hideFromNavigation: true, hideFromSiteSearch: true, hideFromSearchEngines: true },
        user: f.managerA,
        overrideAccess: false,
      })
      .catch(() => null)

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still.hideFromNavigation ?? false).toBe(false)
    expect(still.hideFromSiteSearch ?? false).toBe(false)
    expect(still.hideFromSearchEngines ?? false).toBe(false)
  })

  it('cannot make a page linked', async () => {
    // A linked page sends visitors elsewhere — the district's option (Jason, 2026-10-29).
    await payload
      .update({
        collection: 'pages',
        id: f.draftPageA,
        data: { linkMode: 'redirect', linkTo: 'site', linkTarget: f.publishedPageA },
        user: f.managerA,
        overrideAccess: false,
      })
      .catch(() => null)

    const still = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(still.linkMode ?? 'none').toBe('none')
    expect(still.linkTarget ?? null).toBeNull()
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

  it('a district admin lists versions, and restores only one that was published', async () => {
    const { docs } = await payload.findVersions({
      collection: 'pages',
      where: { parent: { equals: pageId } },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(docs.length).toBeGreaterThanOrEqual(3)

    // Jason, 2026-10-27: a draft that never went live cannot be brought back — by anyone.
    await expect(
      payload.restoreVersion({
        collection: 'pages',
        id: oldDraftId,
        draft: true,
        user: f.districtAdmin,
        overrideAccess: false,
      }),
    ).rejects.toThrow('Only a version that was published can be restored.')
    expect(await latestTitle()).toBe('History v3 current')

    await payload.restoreVersion({
      collection: 'pages',
      id: publishedId,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await latestTitle()).toBe('History v1')
  })

  it('through the Local API a restore PUBLISHES — Payload drops its `draft` option', async () => {
    // Payload 3.87's local `restoreVersion` never forwards `draft` to the operation, so a
    // Local API restore always lands live and clears any pending review. A restore AS A DRAFT
    // (REST `?draft=true`, the admin's own option) is `tests/e2e/page-history.spec.ts`.
    await payload.update({
      collection: 'pages',
      id: pageId,
      data: { title: 'History v4 by the school' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })

    await payload.restoreVersion({
      collection: 'pages',
      id: publishedId,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const live = await payload.findByID({
      collection: 'pages',
      id: pageId,
      draft: false,
      overrideAccess: true,
    })
    expect(live.title).toBe('History v1')
    expect(live._status).toBe('published')
    expect(live.reviewState ?? null).toBeNull()
  })
})

/**
 * Composed pages (Jason, 2026-11-04): schools compose with the SIMPLE components; the district's
 * components — a news feed, columns, an embed — are theirs alone, on every route. Tenant scoping
 * is unchanged: no school composes another's page.
 */
describe('schools compose with the simple components only (`src/access/school-layout.ts`)', () => {
  const words = (value: string) => ({
    blockType: 'richText',
    content: {
      root: {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', text: value }] }],
      },
    },
  })
  let seq = 0
  const slug = () => `compose-${Date.now()}-${(seq += 1)}`

  it('a school-manager creates a composed page from simple components', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'School composed',
        slug: slug(),
        visibility: 'public',
        layout: [words('Hello'), { blockType: 'divider' }],
      } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(page.layout).toHaveLength(2)
  })

  it('a school-manager cannot place a district component — a news feed, columns, an embed', async () => {
    for (const block of [
      { blockType: 'feed', boards: [f.boardA] },
      { blockType: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Video' },
      { blockType: 'columns', columns: [{ content: [words('a')] }, { content: [words('b')] }] },
    ]) {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'pages',
            data: {
              tenant: f.tenantA,
              title: 'Attempt',
              slug: slug(),
              visibility: 'public',
              layout: [block],
            } as never,
            draft: true,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
        block.blockType,
      ).toBe(true)
    }
  })

  it('a school-manager cannot remove or change the district’s component on their own page', async () => {
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantA,
        title: 'District layout',
        slug: slug(),
        visibility: 'public',
        layout: [words('Intro'), { blockType: 'feed', heading: 'News', boards: [f.boardA] }],
      } as never,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const stored = (
      await payload.findByID({
        collection: 'pages',
        id: page.id,
        depth: 0,
        draft: true,
        overrideAccess: true,
      })
    ).layout as unknown as Record<string, unknown>[]

    // Writing around it is fine.
    await payload.update({
      collection: 'pages',
      id: page.id,
      data: { layout: [words('New intro'), stored[1]] } as never,
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    // Removing it, or changing its settings, is not.
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'pages',
          id: page.id,
          data: { layout: [words('Only words')] } as never,
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'pages',
          id: page.id,
          data: { layout: [stored[0], { ...stored[1], heading: 'Mine now' }] } as never,
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('a school-manager still cannot compose another school’s page', async () => {
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'pages',
          data: {
            tenant: f.tenantB,
            title: 'Cross-tenant',
            slug: slug(),
            visibility: 'public',
            layout: [words('x')],
          } as never,
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
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
          data: {
            primary: [{ label: 'Hijacked', linkType: 'address', href: 'https://evil.example' }],
          },
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
        data: {
          tenant: district,
          primary: [{ label: 'About', linkType: 'address', href: '/about' }],
        },
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
      data: { footer: [{ label: 'Contact School B', linkType: 'address', href: '/contact' }] },
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
        data: {
          tenant: f.tenantA,
          primary: [{ label: 'Second', linkType: 'address', href: '/second' }],
        },
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
          data: { primary: [{ label: 'Bad', linkType: 'address', href }] },
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

  it('refuses a color that fails contrast — through the API, not just the admin form', async () => {
    /**
     * `07` §3: "a school cannot pick a brand color that fails". The district admin is the
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

  it('takes a light color as the SECOND color — and still refuses one that is not a color', async () => {
    // The same gold the main color refuses above. It is decorative here (`src/lib/theme.ts`).
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

  it('stores one spelling per color, and lets the district admin clear it', async () => {
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

/**
 * ============================================================================
 * POSTS (`03` §2) — every invariant again, on the first Phase 5 collection, and
 * invariant 3 for the first time.
 * ============================================================================
 */
describe('posts', () => {
  let p: PostFixtures

  beforeAll(async () => {
    p = await seedPosts(payload, f)
  })

  /** A public site, as the renderer sees it — the content layer, not the API. */
  const site = (tenantId: number, slug: string): ContentContext => ({
    tenant: {
      id: String(tenantId),
      slug,
      name: slug,
      hostname: `${slug}.localhost`,
      type: 'school',
    },
    locale: 'en',
  })
  const idsOn = async (tenantId: number) =>
    (await listPosts(site(tenantId, `t${tenantId}`), { limit: 100 })).map((post) => Number(post.id))

  describe('invariant 1 — a user cannot read another school’s posts', () => {
    it("school-manager B cannot read tenant A's draft post", async () => {
      expect(
        await isDenied(() =>
          payload.findByID({
            collection: 'posts',
            id: p.draftPostA,
            user: f.managerB,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it("school-manager A lists only their own school's posts, at every status", async () => {
      const { docs } = await payload.find({
        collection: 'posts',
        user: f.managerA,
        draft: true,
        limit: 100,
        depth: 0,
        overrideAccess: false,
      })
      expect(docs.map((d) => Number(d.id)).sort()).toEqual(
        [p.publishedPostA, p.draftPostA, p.staffPostA].sort(),
      )
    })

    it('a school manager cannot read the district’s syndicated DRAFT through the API', async () => {
      expect(
        await isDenied(() =>
          payload.findByID({
            collection: 'posts',
            id: p.districtWideDraft,
            user: f.managerB,
            draft: true,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it.each([
      ['system-sync', () => f.systemSync],
      ['a school-manager with no school', () => f.noTenantManager],
    ])('%s reads no posts at all', async (_label, user) => {
      expect(
        await readsNothing(() =>
          payload.find({ collection: 'posts', user: user(), draft: true, overrideAccess: false }),
        ),
      ).toBe(true)
    })

    it('a school manager cannot read post history — not even their own school’s', async () => {
      expect(
        await isDenied(() =>
          payload.findVersions({
            collection: 'posts',
            where: { parent: { equals: p.publishedPostA } },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })
  })

  describe('invariant 2 — a user cannot write another school’s posts', () => {
    it('school-manager A cannot update, or bulk-update, a post of B', async () => {
      await isDenied(() =>
        payload.update({
          collection: 'posts',
          id: p.publishedPostB,
          data: { title: 'HIJACKED' },
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      await isDenied(() =>
        payload.update({
          collection: 'posts',
          where: {},
          data: { title: 'BULK HIJACK' },
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      const b = await payload.findByID({
        collection: 'posts',
        id: p.publishedPostB,
        draft: true,
        overrideAccess: true,
      })
      expect(b.title).toBe('published post b')
    })

    it('school-manager A cannot create a post for B', async () => {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'posts',
            data: {
              tenant: f.tenantB,
              board: f.boardB,
              title: 'Rogue',
              slug: 'rogue',
              visibility: 'public',
              body: emptyBody(),
              _status: 'draft',
            },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it('a school manager cannot delete a post — not even their own school’s', async () => {
      expect(
        await isDenied(() =>
          payload.delete({
            collection: 'posts',
            id: p.draftPostA,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })
  })

  describe('invariant 3 — syndicated PUBLISHED posts are the only cross-tenant read', () => {
    it('School B’s site shows its own posts and those shared with it', async () => {
      const ids = await idsOn(f.tenantB)
      expect(ids).toEqual(
        expect.arrayContaining([p.publishedPostB, p.districtWidePost, p.selectedForBPost]),
      )
    })

    it('School B’s site never shows School A’s posts, which nobody shared', async () => {
      const ids = await idsOn(f.tenantB)
      for (const id of [p.publishedPostA, p.draftPostA, p.staffPostA]) expect(ids).not.toContain(id)
    })

    it('a post shared with SELECTED schools reaches only those', async () => {
      expect(await idsOn(f.tenantA)).not.toContain(p.selectedForBPost)
    })

    it('a district-wide DRAFT reaches no site — syndication is not a publish', async () => {
      for (const tenant of [f.tenantA, f.tenantB, f.districtTenant]) {
        expect(await idsOn(tenant)).not.toContain(p.districtWideDraft)
      }
    })

    it('a district-wide STAFF post reaches no public site', async () => {
      for (const tenant of [f.tenantA, f.tenantB, f.districtTenant]) {
        expect(await idsOn(tenant)).not.toContain(p.districtWideStaffPost)
      }
    })

    it('a published post with a newer DRAFT shows the published words, everywhere it is shared', async () => {
      await payload.update({
        collection: 'posts',
        id: p.districtWidePost,
        data: { title: 'UNAPPROVED REWRITE' },
        draft: true,
        overrideAccess: true,
      })
      const titles = (await listPosts(site(f.tenantA, 'a'), { limit: 100 })).map((x) => x.title)
      expect(titles).toContain('district wide post')
      expect(titles).not.toContain('UNAPPROVED REWRITE')
    })

    it('a post taken back to this-tenant stops reaching the schools it was shared with', async () => {
      const post = await payload.create({
        collection: 'posts',
        data: {
          tenant: f.districtTenant,
          board: f.boardDistrict,
          title: 'Briefly shared',
          slug: 'briefly-shared',
          visibility: 'public',
          body: emptyBody(),
          syndication: { scope: 'selected', syndicatedTo: [f.tenantA] },
          _status: 'published',
        },
        user: f.districtAdmin,
        overrideAccess: true,
      })
      expect(await idsOn(f.tenantA)).toContain(post.id)

      // The list stays in the row; only `selected` reads it.
      await payload.update({
        collection: 'posts',
        id: post.id,
        data: { syndication: { scope: 'this-tenant' }, _status: 'published' },
        user: f.districtAdmin,
        overrideAccess: true,
      })
      expect(await idsOn(f.tenantA)).not.toContain(post.id)
    })
  })

  describe('invariant 4 — the public API surface', () => {
    it('an anonymous read returns published, public posts ONLY', async () => {
      const { docs } = await payload.find({
        collection: 'posts',
        limit: 100,
        overrideAccess: false,
      })
      const ids = docs.map((d) => Number(d.id))
      expect(ids).toContain(p.publishedPostA)
      for (const id of [p.draftPostA, p.staffPostA, p.districtWideDraft, p.districtWideStaffPost]) {
        expect(ids).not.toContain(id)
      }
    })

    it('a hand-crafted where clause cannot surface a draft', async () => {
      const { docs } = await payload.find({
        collection: 'posts',
        where: { _status: { equals: 'draft' } },
        draft: true,
        limit: 100,
        overrideAccess: false,
      })
      expect(docs).toHaveLength(0)
    })

    it('an anonymous request cannot read post history', async () => {
      expect(
        await readsNothing(() =>
          payload.findVersions({ collection: 'posts', overrideAccess: false }),
        ),
      ).toBe(true)
    })
  })

  describe('invariant 5 — a school-manager cannot PUBLISH a post by any route', () => {
    it('cannot create a post already marked published, and nothing lands', async () => {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'posts',
            data: {
              tenant: f.tenantA,
              board: f.boardA,
              title: 'Sneaky post',
              slug: 'sneaky-post',
              visibility: 'public',
              body: emptyBody(),
              _status: 'published',
            },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      const { docs } = await payload.find({
        collection: 'posts',
        where: { title: { equals: 'Sneaky post' } },
        draft: true,
        overrideAccess: true,
      })
      expect(docs).toHaveLength(0)
    })

    it('cannot update their own draft to published, singly or in bulk', async () => {
      await isDenied(() =>
        payload.update({
          collection: 'posts',
          id: p.draftPostA,
          data: { _status: 'published' },
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      await isDenied(() =>
        payload.update({
          collection: 'posts',
          where: { id: { equals: p.draftPostA } },
          data: { _status: 'published' },
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      const still = await payload.findByID({
        collection: 'posts',
        id: p.draftPostA,
        draft: true,
        overrideAccess: true,
      })
      expect(still._status).toBe('draft')
    })

    it('the HOOK layer refuses too — with access skipped, a school manager still cannot publish', async () => {
      /**
       * The access function refuses every case above before any hook runs, so without this
       * nothing proves the hooks are wired to posts. `overrideAccess` with the manager on the
       * request is the route where only they stand: `publishGate`, and behind it
       * `applyReviewState`, which also refuses a school manager's publish.
       */
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'posts',
            id: p.draftPostA,
            data: { _status: 'published' },
            user: f.managerA,
            overrideAccess: true,
          }),
        ),
      ).toBe(true)
    })

    it('CAN save a draft and send it for approval — the gate blocks publishing, not working', async () => {
      const sent = await payload.update({
        collection: 'posts',
        id: p.draftPostA,
        data: { title: 'draft post a, edited', reviewState: 'submitted' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      })
      expect(sent.reviewState).toBe('submitted')
      expect(sent._status).toBe('draft')
    })

    it('the district approves it — and the trail records the submit and the approve', async () => {
      const approved = await payload.update({
        collection: 'posts',
        id: p.draftPostA,
        data: { _status: 'published' },
        user: f.districtAdmin,
        overrideAccess: false,
      })
      expect(approved._status).toBe('published')
      expect(approved.reviewState).toBeNull()

      const { docs } = await payload.find({
        collection: 'audit-events',
        where: {
          and: [
            { contentType: { equals: 'posts' } },
            { documentId: { equals: String(p.draftPostA) } },
          ],
        },
        sort: 'createdAt',
        overrideAccess: true,
      })
      expect(docs.map((e) => e.action)).toEqual(['submit', 'approve'])
    })
  })

  describe('what only the district sets', () => {
    it('a school manager’s syndication is dropped — a school post reaches only its school', async () => {
      const post = await payload.create({
        collection: 'posts',
        data: {
          tenant: f.tenantA,
          board: f.boardA,
          title: 'Everywhere please',
          body: emptyBody(),
          syndication: { scope: 'district-wide' },
          _status: 'draft',
        },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      })
      await payload.update({
        collection: 'posts',
        id: post.id,
        data: { syndication: { scope: 'selected', syndicatedTo: [f.tenantB] } },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      })
      // Then the district publishes it, as an approve would.
      await payload.update({
        collection: 'posts',
        id: post.id,
        data: { _status: 'published' },
        user: f.districtAdmin,
        overrideAccess: false,
      })
      expect(await idsOn(f.tenantB)).not.toContain(post.id)
      expect(await idsOn(f.tenantA)).toContain(post.id)
    })

    it('a school manager cannot date a post — the date is stamped when it publishes', async () => {
      const post = await payload.create({
        collection: 'posts',
        data: {
          tenant: f.tenantA,
          board: f.boardA,
          title: 'Pinned to the top',
          body: emptyBody(),
          publishedDate: '2099-01-01T00:00:00.000Z',
          _status: 'draft',
        },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      })
      expect(post.publishedDate ?? null).toBeNull()

      const published = await payload.update({
        collection: 'posts',
        id: post.id,
        data: { _status: 'published' },
        user: f.districtAdmin,
        overrideAccess: false,
      })
      expect(new Date(published.publishedDate!).getFullYear()).toBeLessThan(2099)
    })
  })

  describe('addresses', () => {
    it('a second post with the same headline at one school is numbered; another school’s is not', async () => {
      const make = async (tenant: number) =>
        (
          await payload.create({
            collection: 'posts',
            data: {
              tenant,
              board: boardFor(f, tenant),
              title: 'Picture Day',
              body: emptyBody(),
              _status: 'draft',
            },
            draft: true,
            overrideAccess: true,
          })
        ).slug
      expect(await make(f.tenantA)).toBe('picture-day')
      expect(await make(f.tenantA)).toBe('picture-day-2')
      expect(await make(f.tenantB)).toBe('picture-day')
    })
  })
})

const emptyBody = () =>
  ({
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body.' }] }],
    },
  }) as never

/**
 * ============================================================================
 * FOLDERS, BOARDS AND TAGS (Jason, 2026-10-28) — the district organises; a school
 * reads its own and picks; a feed filter only ever narrows.
 * ============================================================================
 */
describe('announcement folders, boards and tags', () => {
  let p: PostFixtures
  let tagHigh: number
  let tagSports: number
  let athleticsBoardDistrict: number

  const site = (tenantId: number): ContentContext => ({
    tenant: {
      id: String(tenantId),
      slug: `t${tenantId}`,
      name: `t${tenantId}`,
      hostname: `t${tenantId}.localhost`,
      type: 'school',
    },
    locale: 'en',
  })

  beforeAll(async () => {
    p = await seedPosts(payload, f)
    tagHigh = (await payload.create({ collection: 'post-tags', data: { name: 'High' } })).id
    tagSports = (await payload.create({ collection: 'post-tags', data: { name: 'Sports' } })).id
    const folder = await payload.create({
      collection: 'post-folders',
      data: { tenant: f.districtTenant, name: 'Athletics' },
    })
    athleticsBoardDistrict = (
      await payload.create({
        collection: 'post-boards',
        data: { tenant: f.districtTenant, folder: folder.id, name: 'Scores' },
      })
    ).id
    // The district-wide post gets the High tag; the one shared with B only goes on Athletics.
    await payload.update({
      collection: 'posts',
      id: p.districtWidePost,
      data: { tags: [tagHigh], _status: 'published' },
      user: f.districtAdmin,
    })
    await payload.update({
      collection: 'posts',
      id: p.selectedForBPost,
      data: { board: athleticsBoardDistrict, tags: [tagSports], _status: 'published' },
      user: f.districtAdmin,
    })
  })

  it('a board is named by its folder, and renaming the folder renames it', async () => {
    const board = await payload.findByID({ collection: 'post-boards', id: athleticsBoardDistrict })
    expect(board.title).toBe('Athletics → Scores')
    // The district's picker spans every site, so its label names the site too.
    expect(board.label).toBe('District · Athletics → Scores')
    const folderId = relationshipId(board.folder)
    await payload.update({ collection: 'post-folders', id: folderId, data: { name: 'Sport' } })
    expect(
      (await payload.findByID({ collection: 'post-boards', id: athleticsBoardDistrict })).title,
    ).toBe('Sport → Scores')
    expect(
      (await payload.findByID({ collection: 'post-boards', id: athleticsBoardDistrict })).label,
    ).toBe('District · Sport → Scores')
  })

  it('a board cannot sit in another site’s folder', async () => {
    const folderOfA = relationshipId(
      (await payload.findByID({ collection: 'post-boards', id: f.boardA })).folder,
    )
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'post-boards',
          data: { tenant: f.tenantB, folder: folderOfA, name: 'Stolen' },
        }),
      ),
    ).toBe(true)
  })

  it('a school manager reads their own site’s folders and boards, and no other’s', async () => {
    for (const collection of ['post-folders', 'post-boards'] as const) {
      const { docs } = await payload.find({
        collection,
        user: f.managerA,
        overrideAccess: false,
        depth: 0,
        pagination: false,
      })
      expect(docs.length).toBeGreaterThan(0)
      expect(docs.every((d) => String(d.tenant) === String(f.tenantA))).toBe(true)
    }
  })

  it('a school manager reads the tag list but cannot change any of the three', async () => {
    const { docs } = await payload.find({
      collection: 'post-tags',
      user: f.managerA,
      overrideAccess: false,
    })
    expect(docs.map((d) => d.name)).toEqual(expect.arrayContaining(['High', 'Sports']))

    const attempts = [
      () =>
        payload.create({
          collection: 'post-tags',
          data: { name: 'Mine' },
          user: f.managerA,
          overrideAccess: false,
        }),
      () =>
        payload.create({
          collection: 'post-folders',
          data: { tenant: f.tenantA, name: 'Mine' },
          user: f.managerA,
          overrideAccess: false,
        }),
      () =>
        payload.update({
          collection: 'post-boards',
          id: f.boardA,
          data: { name: 'Renamed' },
          user: f.managerA,
          overrideAccess: false,
        }),
      () =>
        payload.delete({
          collection: 'post-boards',
          id: f.boardA,
          user: f.managerA,
          overrideAccess: false,
        }),
    ]
    for (const attempt of attempts) expect(await isDenied(attempt)).toBe(true)
  })

  it.each([
    ['the sync account', () => f.systemSync],
    ['anonymous', () => undefined],
  ])('%s reads none of them', async (_label, user) => {
    for (const collection of ['post-folders', 'post-boards', 'post-tags'] as const) {
      expect(
        await readsNothing(() =>
          payload.find({ collection, user: user() as never, overrideAccess: false }),
        ),
      ).toBe(true)
    }
  })

  it('a school manager cannot file an announcement on another school’s board', async () => {
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'posts',
          data: { tenant: f.tenantA, board: f.boardB, title: 'Wrong board', _status: 'draft' },
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'posts',
          id: p.draftPostA,
          data: { board: f.boardB },
          draft: true,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('a news feed on School B’s page may pick the DISTRICT’s board — an announcement may not', async () => {
    // The tenant plugin limits every board picker to the page's own site; the feed's is opened.
    const page = await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantB,
        title: 'Feed page',
        slug: `feed-page-${Date.now()}`,
        visibility: 'public',
        layout: [{ blockType: 'feed', boards: [f.boardDistrict], limit: 5 }],
      },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(page.layout).toHaveLength(1)
    // …and the announcement's own board is still its site's, through the same plugin.
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'posts',
          data: { tenant: f.tenantB, board: f.boardDistrict, title: 'Wrong', _status: 'draft' },
          draft: true,
          user: f.districtAdmin,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })

  it('a school manager still cannot put a feed on a page at all', async () => {
    // Refused, or `layout` dropped by field access — either way, no feed lands.
    await isDenied(() =>
      payload.update({
        collection: 'pages',
        id: f.draftPageA,
        data: { layout: [{ blockType: 'feed', boards: [f.boardA], limit: 5 }] },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      }),
    )
    const stored = await payload.findByID({
      collection: 'pages',
      id: f.draftPageA,
      draft: true,
      overrideAccess: true,
    })
    expect(stored.layout ?? []).toEqual([])
  })

  describe('feeds narrow by board and tag — never past the post’s own sharing', () => {
    const ids = async (tenant: number, filter: { boards?: number[]; tags?: number[] }) =>
      (
        await listPosts(site(tenant), {
          limit: 100,
          ...(filter.boards ? { boards: filter.boards.map(String) } : {}),
          ...(filter.tags ? { tags: filter.tags.map(String) } : {}),
        })
      ).map((x) => Number(x.id))

    // Membership, not equality: the `posts` block above seeds its own set onto the same boards.
    it('own board only', async () => {
      const onB = await ids(f.tenantB, { boards: [f.boardB] })
      expect(onB).toContain(p.publishedPostB)
      for (const id of [p.districtWidePost, p.selectedForBPost]) expect(onB).not.toContain(id)
    })

    it('another site’s board shows only what is shared HERE', async () => {
      const districtNewsOnB = await ids(f.tenantB, { boards: [f.boardDistrict] })
      expect(districtNewsOnB).toContain(p.districtWidePost)
      for (const id of [p.districtWideDraft, p.districtWideStaffPost, p.selectedForBPost]) {
        expect(districtNewsOnB).not.toContain(id)
      }
      // Athletics → Scores holds the post shared with B only: A picking it gets nothing.
      expect(await ids(f.tenantA, { boards: [athleticsBoardDistrict] })).toEqual([])
      expect(await ids(f.tenantB, { boards: [athleticsBoardDistrict] })).toEqual([
        p.selectedForBPost,
      ])
    })

    it('tags match ANY, within reach', async () => {
      expect((await ids(f.tenantB, { tags: [tagHigh, tagSports] })).sort()).toEqual(
        [p.districtWidePost, p.selectedForBPost].sort(),
      )
      expect(await ids(f.tenantA, { tags: [tagSports] })).toEqual([])
    })

    it('boards then tags', async () => {
      expect(await ids(f.tenantB, { boards: [f.boardDistrict], tags: [tagSports] })).toEqual([])
    })
  })
})

describe('events and calendars (Jason, 2026-10-28 and 2026-11-11)', () => {
  let e: EventFixtures

  beforeAll(async () => {
    e = await seedEvents(payload, f)
  })

  const event = (
    tenant: number,
    calendar: number,
    title: string,
    extra: Record<string, unknown> = {},
  ) => ({
    tenant,
    calendar,
    title,
    start: '2026-12-04T23:00:00.000Z',
    ...extra,
  })

  describe('invariant 1 — a user cannot read another school’s events or calendars', () => {
    it("school-manager B cannot read tenant A's events, published or not", async () => {
      for (const id of [e.publishedEventA, e.draftEventA]) {
        expect(
          await isDenied(() =>
            payload.findByID({
              collection: 'events',
              id,
              draft: true,
              user: f.managerB,
              overrideAccess: false,
            }),
          ),
        ).toBe(true)
      }
    })

    it("school-manager A lists only their own school's events, at every status", async () => {
      const { docs } = await payload.find({
        collection: 'events',
        draft: true,
        user: f.managerA,
        overrideAccess: false,
        pagination: false,
      })
      expect(docs.map((d) => d.id).sort()).toEqual([e.publishedEventA, e.draftEventA].sort())
    })

    it("school-manager A lists only their own school's calendars", async () => {
      const { docs } = await payload.find({
        collection: 'calendars',
        user: f.managerA,
        overrideAccess: false,
        pagination: false,
      })
      expect(docs.map((d) => d.id)).toEqual([e.calendarA])
    })

    it.each([
      ['system-sync', () => f.systemSync],
      ['a school-manager with no school', () => f.noTenantManager],
    ])('%s reads no events and no calendars', async (_label, user) => {
      for (const collection of ['events', 'calendars'] as const) {
        expect(
          await readsNothing(() =>
            payload.find({ collection, user: user(), draft: true, overrideAccess: false }),
          ),
        ).toBe(true)
      }
    })
  })

  describe('invariant 2 — a user cannot write another school’s events or any calendar', () => {
    it('school-manager A cannot create an event in School B', async () => {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'events',
            data: event(f.tenantB, e.calendarB, 'Into B'),
            draft: true,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it('school-manager A cannot edit School B’s event, singly or in bulk', async () => {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'events',
            id: e.publishedEventB,
            data: { title: 'Hijacked' },
            draft: true,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      await payload.update({
        collection: 'events',
        where: { id: { equals: e.publishedEventB } },
        data: { title: 'Hijacked' },
        draft: true,
        user: f.managerA,
        overrideAccess: false,
      })
      const still = await payload.findByID({
        collection: 'events',
        id: e.publishedEventB,
        overrideAccess: true,
      })
      expect(still.title).toBe('published event b')
    })

    it('an event cannot go on another site’s calendar — not even by the district', async () => {
      for (const user of [f.managerA, f.districtAdmin]) {
        expect(
          await isDenied(() =>
            payload.create({
              collection: 'events',
              data: event(f.tenantA, e.calendarB, 'Wrong calendar'),
              draft: true,
              user,
              overrideAccess: false,
            }),
          ),
        ).toBe(true)
      }
    })

    it('a school manager cannot create, rename or delete a calendar', async () => {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'calendars',
            data: { tenant: f.tenantA, name: 'My own' },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'calendars',
            id: e.calendarA,
            data: { name: 'Renamed' },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.delete({
            collection: 'calendars',
            id: e.calendarA,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it('a school manager cannot delete another school’s event', async () => {
      expect(
        await isDenied(() =>
          payload.delete({
            collection: 'events',
            id: e.publishedEventB,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      await payload.delete({
        collection: 'events',
        where: { id: { equals: e.publishedEventB } },
        user: f.managerA,
        overrideAccess: false,
      })
      expect(
        await payload.findByID({
          collection: 'events',
          id: e.publishedEventB,
          overrideAccess: true,
        }),
      ).toBeTruthy()
    })
  })

  describe('invariant 3 — the public site reads by the block’s calendars, published only', () => {
    const site = (tenantId: number): ContentContext => ({
      tenant: {
        id: String(tenantId),
        slug: 's',
        name: 's',
        hostname: 's.localhost',
        type: 'school',
      },
      locale: 'en',
    })
    const titles = async (calendars: number[]) =>
      (
        await listEventOccurrences(site(f.tenantB), {
          calendars: calendars.map(String),
          range: { from: '2026-12-01', to: '2026-12-31' },
        })
      ).map((o) => o.title)

    it('shows the chosen calendars’ published events — another site’s too, when chosen', async () => {
      expect((await titles([e.calendarB, e.calendarDistrictHs])).sort()).toEqual([
        'district hs event',
        'published event b',
      ])
    })

    it('never a draft, even on a chosen calendar', async () => {
      expect(await titles([e.calendarA])).toEqual(['published event a'])
    })

    it('nothing from a calendar not chosen', async () => {
      expect(await titles([e.calendarB])).toEqual(['published event b'])
      expect(await titles([])).toEqual([])
    })
  })

  describe('invariant 4 — the public API surface', () => {
    it('an anonymous read returns published events ONLY', async () => {
      const { docs } = await payload.find({
        collection: 'events',
        draft: true,
        overrideAccess: false,
        pagination: false,
      })
      expect(docs.map((d) => d.id)).not.toContain(e.draftEventA)
      expect(docs.map((d) => d.id)).toContain(e.publishedEventA)
    })

    it('an anonymous caller reads no calendars and no event history', async () => {
      expect(
        await readsNothing(() => payload.find({ collection: 'calendars', overrideAccess: false })),
      ).toBe(true)
      expect(
        await readsNothing(() =>
          payload.findVersions({ collection: 'events', overrideAccess: false }),
        ),
      ).toBe(true)
    })
  })

  /**
   * EVENTS SKIP APPROVAL (Jason, 2026-11-11): invariant 5 is lifted for events, by his decision —
   * a school manager publishes and removes their OWN school's events. These prove the lift is
   * exactly that wide: their own school, nobody else's, and on the district's activity log.
   */
  describe('events skip approval — a school manager publishes their own school’s, and only theirs', () => {
    it('publishes an event straight onto their own school’s calendar', async () => {
      const made = await payload.create({
        collection: 'events',
        data: event(f.tenantA, e.calendarA, 'Straight on', { _status: 'published' }),
        user: f.managerA,
        overrideAccess: false,
      })
      expect(made._status).toBe('published')
    })

    it('puts their own draft on the calendar', async () => {
      const published = await payload.update({
        collection: 'events',
        id: e.draftEventA,
        data: { _status: 'published' },
        user: f.managerA,
        overrideAccess: false,
      })
      expect(published._status).toBe('published')
    })

    it('can NOT publish into another school, by create or update, singly or in bulk', async () => {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'events',
            data: event(f.tenantB, e.calendarB, 'Into B, live', { _status: 'published' }),
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      await isDenied(() =>
        payload.update({
          collection: 'events',
          id: e.publishedEventB,
          data: { title: 'Hijacked live', _status: 'published' },
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      await payload.update({
        collection: 'events',
        where: { id: { equals: e.publishedEventB } },
        data: { title: 'Hijacked live', _status: 'published' },
        user: f.managerA,
        overrideAccess: false,
      })
      const still = await payload.findByID({
        collection: 'events',
        id: e.publishedEventB,
        overrideAccess: true,
      })
      expect(still.title).toBe('published event b')
    })

    it('removes their own school’s event — and the district sees both on the activity log', async () => {
      const made = await payload.create({
        collection: 'events',
        data: event(f.tenantA, e.calendarA, 'Cancelled game', { _status: 'published' }),
        user: f.managerA,
        overrideAccess: false,
      })
      await payload.delete({
        collection: 'events',
        id: made.id,
        user: f.managerA,
        overrideAccess: false,
      })
      const { docs } = await payload.find({
        collection: 'audit-events',
        where: {
          and: [{ contentType: { equals: 'events' } }, { documentId: { equals: String(made.id) } }],
        },
        sort: 'createdAt',
        overrideAccess: true,
      })
      expect(docs.map((d) => [d.action, d.actorLabel])).toEqual([
        ['publish', f.managerA.email],
        ['delete', f.managerA.email],
      ])
    })

    it('pages and announcements are untouched: the same manager still cannot publish a page', async () => {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'pages',
            id: f.draftPageA,
            data: { _status: 'published' },
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })
  })
})

const relationshipId = (value: unknown): number =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

describe('the file library (Jason, 2026-11-13)', () => {
  // Schools upload to their own library with no approval, so isolation is the whole guarantee.
  const r = { fileA: 0, fileB: 0, folderA: 0, folderB: 0 }

  beforeAll(async () => {
    const make = async (tenant: number, title: string) =>
      (
        await payload.create({
          collection: 'resources',
          data: { tenant, title, isDecorative: true } as never,
          file: await tinyPng(),
          overrideAccess: true,
        })
      ).id as number
    const folder = async (tenant: number, name: string) =>
      (
        await payload.create({
          collection: 'resource-folders',
          data: { tenant, name } as never,
          overrideAccess: true,
        })
      ).id as number
    r.fileA = await make(f.tenantA, 'file a')
    r.fileB = await make(f.tenantB, 'file b')
    r.folderA = await folder(f.tenantA, 'folder a')
    r.folderB = await folder(f.tenantB, 'folder b')
  })

  describe('invariant 1 — a user cannot read another school’s files or folders', () => {
    it('school-manager A lists and fetches only School A’s', async () => {
      for (const collection of ['resources', 'resource-folders'] as const) {
        const { docs } = await payload.find({
          collection,
          user: f.managerA,
          overrideAccess: false,
          limit: 0,
          depth: 0,
        })
        expect(docs.every((d) => d.tenant === f.tenantA)).toBe(true)
      }
      expect(
        await isDenied(() =>
          payload.findByID({
            collection: 'resources',
            id: r.fileB,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })
  })

  describe('invariant 2 — a user cannot write into another school’s library', () => {
    it('school-manager A cannot upload into School B', async () => {
      expect(
        await isDenied(async () =>
          payload.create({
            collection: 'resources',
            data: { tenant: f.tenantB, title: 'Into B', isDecorative: true } as never,
            file: await tinyPng(),
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })

    it('school-manager A cannot change or remove School B’s file, singly or in bulk', async () => {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'resources',
            id: r.fileB,
            data: { title: 'Hijacked' } as never,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      await payload.update({
        collection: 'resources',
        where: { id: { equals: r.fileB } },
        data: { title: 'Hijacked' } as never,
        user: f.managerA,
        overrideAccess: false,
      })
      await payload.delete({
        collection: 'resources',
        where: { id: { equals: r.fileB } },
        user: f.managerA,
        overrideAccess: false,
      })
      const still = await payload.findByID({
        collection: 'resources',
        id: r.fileB,
        overrideAccess: true,
      })
      expect(still.title).toBe('file b')
    })

    it('school-manager A cannot move their own file into School B', async () => {
      await isDenied(() =>
        payload.update({
          collection: 'resources',
          id: r.fileA,
          data: { tenant: f.tenantB } as never,
          user: f.managerA,
          overrideAccess: false,
        }),
      )
      const mine = await payload.findByID({
        collection: 'resources',
        id: r.fileA,
        depth: 0,
        overrideAccess: true,
      })
      expect(mine.tenant).toBe(f.tenantA)
    })

    it('nor put a file or folder of A’s in School B’s folder', async () => {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'resources',
            id: r.fileA,
            data: { folder: r.folderB } as never,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'resource-folders',
            id: r.folderA,
            data: { parent: r.folderB } as never,
            user: f.managerA,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    })
  })
})

/**
 * Site search (Jason, 2026-11-16; Phase 6 D). The index holds every site's public words, so it is
 * read ONLY by the content layer's scoped query (`searchSite`, its own adversarial cases in
 * tests/integration/search.test.ts). Through Payload's access — REST, GraphQL, the admin — nobody
 * reads, writes or reindexes it: not a visitor, not a school manager, not the district.
 */
describe('the site search index', () => {
  beforeAll(async () => {
    await payload.create({
      collection: 'pages',
      data: {
        tenant: f.tenantB,
        title: 'B’s indexed page',
        slug: `b-indexed-${Date.now()}`,
        visibility: 'public',
        layout: [],
        _status: 'published',
      } as never,
      overrideAccess: true,
      user: f.districtAdmin,
    })
  })

  it('there is something in it to protect', async () => {
    const { totalDocs } = await payload.count({ collection: 'search', overrideAccess: true })
    expect(totalDocs).toBeGreaterThan(0)
  })

  it.each([
    ['a visitor', undefined],
    ['a school manager', 'managerA'],
    ['the district', 'districtAdmin'],
  ] as const)('%s reads none of it through Payload’s access', async (_label, who) => {
    const user = who === undefined ? undefined : f[who]
    expect(
      await readsNothing(() =>
        payload.find({ collection: 'search', ...(user ? { user } : {}), overrideAccess: false }),
      ),
    ).toBe(true)
  })

  it('a school manager can neither write an entry nor change one', async () => {
    expect(
      await isDenied(() =>
        payload.create({
          collection: 'search',
          data: { title: 'Planted', tenant: f.tenantA } as never,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
    const { docs } = await payload.find({ collection: 'search', limit: 1, overrideAccess: true })
    expect(
      await isDenied(() =>
        payload.update({
          collection: 'search',
          id: docs[0]!.id,
          data: { excluded: false, tenant: f.tenantA } as never,
          user: f.managerA,
          overrideAccess: false,
        }),
      ),
    ).toBe(true)
  })
})

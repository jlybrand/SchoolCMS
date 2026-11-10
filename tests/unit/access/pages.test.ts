import { describe, expect, it } from 'vitest'

import {
  canComposePages,
  canPublish,
  canUsePageHistory,
  pagesCreateAccess,
  pagesDeleteAccess,
  pagesReadAccess,
  pagesReadVersionsAccess,
  pagesUpdateAccess,
  PUBLIC_PAGE_CONSTRAINT,
} from '@/access/pages'
import type { AuthUser } from '@/access/types'

/**
 * Access control for `pages` (`03` §2, §6.2).
 *
 * Test-first, and mandatory: this file covers three of the five 100%-intent areas in
 * `06` §7 at once — tenant isolation, the publish gate, and the composed-page boundary.
 *
 * TWO PROPERTIES ARE LOAD-BEARING HERE:
 *
 *   1. Reads return a QUERY CONSTRAINT, never a bare `true`, for any scoped user
 *      (`03` §6.2). A boolean hands back the collection and trusts the UI to filter.
 *
 *   2. A `school-manager` cannot publish BY ANY ROUTE (CLAUDE.md rule 3, `03` §6.4
 *      invariant 5). This file is the access half of that gate; the hook half lives in
 *      src/collections/hooks/publish-gate.ts and is proven again over REST, GraphQL and
 *      the Local API in tests/integration/tenant-isolation.test.ts. Two layers because a
 *      single one is one refactor away from being the zero layers nobody noticed.
 */

/** Builds access-function args. Cast at the boundary so call sites stay readable. */
const args = (user: AuthUser | null, extra: Record<string, unknown> = {}) =>
  ({ req: { user }, ...extra }) as never

const districtAdmin: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const managerAB: AuthUser = {
  id: 'u3',
  roles: ['school-manager'],
  tenants: [{ tenant: 'A' }, { tenant: 'B' }],
}
const managerNoTenant: AuthUser = { id: 'u4', roles: ['school-manager'], tenants: [] }
const systemSync: AuthUser = { id: 'u5', roles: ['system-sync'], tenants: [{ tenant: 'A' }] }

describe('canPublish', () => {
  it('grants district-admin', () => {
    expect(canPublish(districtAdmin)).toBe(true)
  })

  it.each([
    ['school-manager', managerA],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(canPublish(user)).toBe(false)
  })
})

describe('canComposePages — who places ANY component', () => {
  /**
   * The single predicate `03` §2 kept for this day (Jason, 2026-11-04): schools now compose, but
   * with the simple components only (`src/access/school-layout.ts`). Placing any component — a
   * news feed, columns, an embed — stays the district's.
   */
  it('grants district-admin', () => {
    expect(canComposePages(districtAdmin)).toBe(true)
  })

  it('denies a school-manager — they compose with the simple palette', () => {
    expect(canComposePages(managerA)).toBe(false)
  })
})

describe('pagesReadAccess', () => {
  it('grants unrestricted read to district-admin', () => {
    expect(pagesReadAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    const result = pagesReadAccess(args(managerA))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('constrains to every assigned tenant for a multi-school manager', () => {
    expect(pagesReadAccess(args(managerAB))).toEqual({ tenant: { in: ['A', 'B'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(pagesReadAccess(args(managerNoTenant))).toBe(false)
  })

  it('DENIES system-sync outright — it owns no pages', () => {
    /**
     * `03` §6.1 and `11`: the sync actor may touch `people` source-owned fields in mapped
     * tenants and NOTHING else. Reusing the generic tenant-scoped read here would have
     * handed it a constraint over `pages` instead, which is why this collection declares
     * its own functions rather than importing the shared ones.
     */
    expect(pagesReadAccess(args(systemSync))).toBe(false)
  })

  it('gives anonymous callers published, public pages only', () => {
    /**
     * `03` §6.4 invariant 4 — the public REST/GraphQL surface never returns drafts or
     * staff-visibility content. This is the constraint that makes the API surface safe;
     * the website itself does not rely on it, since it reads through src/content/* with
     * access overridden.
     */
    expect(pagesReadAccess(args(null))).toEqual(PUBLIC_PAGE_CONSTRAINT)
  })

  it('the public constraint filters BOTH status and visibility', () => {
    // Asserted structurally: dropping either half is a silent leak that a shape-agnostic
    // assertion would not catch.
    expect(PUBLIC_PAGE_CONSTRAINT).toEqual({
      and: [{ _status: { equals: 'published' } }, { visibility: { equals: 'public' } }],
    })
  })
})

describe('pagesCreateAccess', () => {
  it('allows district-admin to create in any tenant', () => {
    expect(pagesCreateAccess(args(districtAdmin, { data: { tenant: 'Z' } }))).toBe(true)
  })

  it('allows a school-manager inside their own tenant', () => {
    expect(pagesCreateAccess(args(managerA, { data: { tenant: 'A' } }))).toBe(true)
  })

  it('DENIES a school-manager creating into another tenant', () => {
    expect(pagesCreateAccess(args(managerA, { data: { tenant: 'B' } }))).toBe(false)
  })

  it('denies a create with no tenant — never fails open', () => {
    expect(pagesCreateAccess(args(managerA, { data: {} }))).toBe(false)
  })

  it('denies anonymous creates', () => {
    expect(pagesCreateAccess(args(null, { data: { tenant: 'A' } }))).toBe(false)
  })

  it('denies system-sync', () => {
    expect(pagesCreateAccess(args(systemSync, { data: { tenant: 'A' } }))).toBe(false)
  })

  describe('the publish gate', () => {
    it('DENIES a school-manager creating a page already marked published', () => {
      // The create-with-_status route: no update ever happens, so an update-only gate
      // would miss this entirely.
      expect(
        pagesCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } })),
      ).toBe(false)
    })

    it('allows a school-manager to create a draft', () => {
      expect(pagesCreateAccess(args(managerA, { data: { tenant: 'A', _status: 'draft' } }))).toBe(
        true,
      )
    })

    it('allows district-admin to create a published page directly', () => {
      expect(
        pagesCreateAccess(args(districtAdmin, { data: { tenant: 'A', _status: 'published' } })),
      ).toBe(true)
    })
  })

  describe('every page is composed (Jason, 2026-11-04) — which sections is the hook’s', () => {
    it('allows a school-manager a page in their school', () => {
      expect(pagesCreateAccess(args(managerA, { data: { tenant: 'A', layout: [] } }))).toBe(true)
    })

    it('still DENIES one in another school', () => {
      expect(pagesCreateAccess(args(managerA, { data: { tenant: 'B', layout: [] } }))).toBe(false)
    })

    it('allows district-admin', () => {
      expect(pagesCreateAccess(args(districtAdmin, { data: { tenant: 'A', layout: [] } }))).toBe(
        true,
      )
    })
  })
})

describe('pagesUpdateAccess', () => {
  it('grants district-admin', () => {
    expect(pagesUpdateAccess(args(districtAdmin))).toBe(true)
  })

  it('returns a query constraint for a school-manager — NEVER true', () => {
    /**
     * A constraint rather than a boolean matters more on write than on read: Payload's
     * access args carry `id` and `data`, not the existing document, so a boolean written
     * against `data` alone is satisfied by a partial update that simply omits `tenant`.
     */
    const result = pagesUpdateAccess(args(managerA, { data: { title: 'Edited' } }))
    expect(result).not.toBe(true)
    expect(result).toEqual({ tenant: { in: ['A'] } })
  })

  it('denies a school-manager with no tenant assignment', () => {
    expect(pagesUpdateAccess(args(managerNoTenant))).toBe(false)
  })

  it('denies anonymous updates', () => {
    expect(pagesUpdateAccess(args(null))).toBe(false)
  })

  it('denies system-sync', () => {
    expect(pagesUpdateAccess(args(systemSync))).toBe(false)
  })

  describe('the publish gate', () => {
    it('DENIES a school-manager transitioning a page to published', () => {
      expect(pagesUpdateAccess(args(managerA, { data: { _status: 'published' } }))).toBe(false)
    })

    it('denies it for a page inside their OWN tenant — scope is not the point', () => {
      // The failure mode worth naming: "it's their page" is not permission to publish it.
      expect(
        pagesUpdateAccess(args(managerA, { data: { tenant: 'A', _status: 'published' } })),
      ).toBe(false)
    })

    it('still allows a school-manager to save a draft', () => {
      expect(pagesUpdateAccess(args(managerA, { data: { _status: 'draft' } }))).toEqual({
        tenant: { in: ['A'] },
      })
    })

    it('DENIES a school-manager setting publishAt — a scheduled publish is a publish', () => {
      /**
       * The route that gets forgotten. `publishAt` defers the transition rather than
       * cancelling it, so leaving it ungated would let a school-manager publish by simply
       * waiting. It is ALSO district-only at field level in the collection config; this is
       * the belt to that braces.
       */
      expect(
        pagesUpdateAccess(args(managerA, { data: { publishAt: '2026-09-01T00:00:00.000Z' } })),
      ).toBe(false)
    })

    it('allows district-admin to publish', () => {
      expect(pagesUpdateAccess(args(districtAdmin, { data: { _status: 'published' } }))).toBe(true)
    })
  })

  it('lets a school-manager write sections — as a constraint, never true', () => {
    expect(pagesUpdateAccess(args(managerA, { data: { layout: [] } }))).toEqual({
      tenant: { in: ['A'] },
    })
  })
})

describe('pagesDeleteAccess', () => {
  it('is reserved to district-admin (`03` §6.2)', () => {
    expect(pagesDeleteAccess(args(districtAdmin))).toBe(true)
  })

  it.each([
    ['school-manager', managerA],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(pagesDeleteAccess(args(user))).toBe(false)
  })
})

/**
 * Page history — district-only (Jason, 2026-10-27). A school manager neither sees past
 * versions nor restores one; `04` §2.1 rules out draft-vs-published as a visible concept for
 * them, and a restore would bring back content the district has not re-read.
 */
describe('canUsePageHistory', () => {
  it('grants district-admin', () => {
    expect(canUsePageHistory(districtAdmin)).toBe(true)
  })

  it.each([
    ['school-manager', managerA],
    ['school-manager in two schools', managerAB],
    ['system-sync', systemSync],
    ['anonymous', null],
  ])('denies %s', (_label, user) => {
    expect(canUsePageHistory(user)).toBe(false)
  })
})

describe('pagesReadVersionsAccess', () => {
  it('grants district-admin', () => {
    expect(pagesReadVersionsAccess(args(districtAdmin))).toBe(true)
  })

  it.each([
    ['school-manager — even in their own school', managerA],
    ['school-manager with no school', managerNoTenant],
    ['system-sync', systemSync],
    ['anonymous — no public constraint either', null],
  ])('denies %s outright', (_label, user) => {
    expect(pagesReadVersionsAccess(args(user))).toBe(false)
  })
})

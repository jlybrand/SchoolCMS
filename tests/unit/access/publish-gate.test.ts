import { Forbidden } from 'payload'
import { describe, expect, it } from 'vitest'

import type { AuthUser } from '@/access/types'
import { composedPagesAreDistrictOnly, publishGate } from '@/collections/hooks/publish-gate'

/**
 * The hook half of the publish gate (CLAUDE.md rule 3, `03` §6.4 invariant 5).
 *
 * WHY A SECOND LAYER. The access function in `src/access/pages.ts` judges the incoming
 * `data`. This hook runs after Payload has merged that data over the existing document, so
 * it sees the RESULT of the write rather than the request — which is what catches:
 *
 *   - bulk operations, where the per-document shape is not what the caller sent
 *   - any future code path that reaches `create`/`update` with a different payload shape
 *   - a partial update that omits the field the access function was reading
 *
 * `05` calls the publish gate release-blocking and CLAUDE.md requires it at both the access
 * and hook layer. Neither layer is redundant: the access function fails the request early
 * and cheaply, and this one is the backstop that does not depend on the request's shape.
 */

const districtAdmin: AuthUser = { id: 'u1', roles: ['district-admin'], tenants: [] }
const managerA: AuthUser = { id: 'u2', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
const systemSync: AuthUser = { id: 'u3', roles: ['system-sync'], tenants: [{ tenant: 'A' }] }

/** Builds hook args. Cast at the boundary so call sites stay readable. */
const hookArgs = (
  user: AuthUser | null,
  data: Record<string, unknown>,
  originalDoc?: Record<string, unknown>,
  operation: 'create' | 'update' = 'update',
) => ({ req: { user }, data, originalDoc, operation }) as never

describe('publishGate', () => {
  it('lets district-admin publish', () => {
    expect(() => publishGate(hookArgs(districtAdmin, { _status: 'published' }))).not.toThrow()
  })

  it('lets a school-manager save a draft', () => {
    expect(() => publishGate(hookArgs(managerA, { _status: 'draft' }))).not.toThrow()
  })

  it('THROWS when a school-manager publishes', () => {
    expect(() => publishGate(hookArgs(managerA, { _status: 'published' }))).toThrow(Forbidden)
  })

  it('throws when a school-manager creates an already-published page', () => {
    expect(() =>
      publishGate(hookArgs(managerA, { _status: 'published' }, undefined, 'create')),
    ).toThrow(Forbidden)
  })

  it('throws when a school-manager schedules a publish via publishAt', () => {
    expect(() =>
      publishGate(hookArgs(managerA, { publishAt: '2026-09-01T00:00:00.000Z' })),
    ).toThrow(Forbidden)
  })

  it('throws when a school-manager CHANGES a Start the district set', () => {
    expect(() =>
      publishGate(
        hookArgs(
          managerA,
          { _status: 'draft', publishAt: '2026-12-01T00:00:00.000Z' },
          { publishAt: '2026-11-10T13:00:00.000Z' },
        ),
      ),
    ).toThrow(Forbidden)
  })

  /**
   * Payload merges the stored document into every write, so a school's save on a post the
   * district approved for later CARRIES the stored Start. That is not the school scheduling
   * anything — it is the edit `04` §5 allows, and it drops the approval (Jason, 2026-11-04).
   */
  it('lets a school-manager edit a post that carries the district’s Start unchanged', () => {
    const start = '2026-11-10T13:00:00.000Z'
    expect(() =>
      publishGate(hookArgs(managerA, { _status: 'draft', publishAt: start }, { publishAt: start })),
    ).not.toThrow()
    // As Payload hands it back: a Date on one side, a string on the other.
    expect(() =>
      publishGate(
        hookArgs(managerA, { _status: 'draft', publishAt: new Date(start) }, { publishAt: start }),
      ),
    ).not.toThrow()
  })

  it('throws for system-sync — a non-human actor publishes nothing', () => {
    expect(() => publishGate(hookArgs(systemSync, { _status: 'published' }))).toThrow(Forbidden)
  })

  it('throws for an unauthenticated write', () => {
    expect(() => publishGate(hookArgs(null, { _status: 'published' }))).toThrow(Forbidden)
  })

  it('allows a school-manager to edit a page that is ALREADY published', () => {
    /**
     * The distinction this hook has to get right. Editing a live page creates a new draft
     * version; it is not a publish transition, and blocking it would make published pages
     * uneditable by the people who maintain them. What the gate forbids is CHANGING the
     * status to published — so a draft-status write against a published original passes.
     */
    expect(() =>
      publishGate(
        hookArgs(managerA, { title: 'Edited', _status: 'draft' }, { _status: 'published' }),
      ),
    ).not.toThrow()
  })

  it('throws when the write would re-publish an already-published page', () => {
    // Same status in and out, but the write still asserts published — deny it. Allowing a
    // no-op publish is how "it did not change anything" becomes a usable route.
    expect(() =>
      publishGate(hookArgs(managerA, { _status: 'published' }, { _status: 'published' })),
    ).toThrow(Forbidden)
  })

  it('returns the data unchanged when it allows the write', () => {
    // beforeChange hooks feed their return value into the next hook; dropping fields here
    // would silently discard the edit.
    const data = { title: 'Bell Schedule', _status: 'draft' }
    expect(publishGate(hookArgs(managerA, data))).toEqual(data)
  })
})

describe('composedPagesAreDistrictOnly', () => {
  it('lets district-admin write a composed page', () => {
    expect(() =>
      composedPagesAreDistrictOnly(hookArgs(districtAdmin, { pageType: 'composed' })),
    ).not.toThrow()
  })

  it('THROWS when a school-manager writes a composed page', () => {
    expect(() =>
      composedPagesAreDistrictOnly(hookArgs(managerA, { pageType: 'composed' })),
    ).toThrow(Forbidden)
  })

  it('lets a school-manager write the fixed page types', () => {
    for (const pageType of ['standard', 'about', 'contact', 'staff', 'calendar', 'documents']) {
      expect(() => composedPagesAreDistrictOnly(hookArgs(managerA, { pageType }))).not.toThrow()
    }
  })

  it('THROWS on a partial update that omits pageType but targets a composed page', () => {
    /**
     * The case the access function structurally cannot catch: `data` carries only `title`,
     * so there is no `pageType` in the request to judge. Merging over `originalDoc` is the
     * whole reason this hook exists.
     */
    expect(() =>
      composedPagesAreDistrictOnly(
        hookArgs(managerA, { title: 'Edited' }, { pageType: 'composed' }),
      ),
    ).toThrow(Forbidden)
  })

  it('THROWS when a school-manager sends a layout array on a fixed-type page', () => {
    // Blocks are district-only whatever the pageType says (`03` §3).
    expect(() =>
      composedPagesAreDistrictOnly(
        hookArgs(managerA, { pageType: 'standard', layout: [{ blockType: 'Hero' }] }),
      ),
    ).toThrow(Forbidden)
  })

  it('returns the data unchanged when it allows the write', () => {
    const data = { title: 'About Us', pageType: 'about' }
    expect(composedPagesAreDistrictOnly(hookArgs(managerA, data))).toEqual(data)
  })
})

/**
 * The ONE publish a school manager's request may cause: the auto-approval hook publishing an
 * announcement on their behalf under a district grant (`04` §4.3). It marks its own write in
 * `req.context`, which Payload fills only from server code — a request cannot set it — so the
 * same body sent by a person is still refused.
 */
describe('publishGate — the auto-approval publish', () => {
  const managerA = { id: 'm1', roles: ['school-manager'], tenants: [{ tenant: 'A' }] }
  const run = (context: Record<string, unknown>, data: Record<string, unknown> = {}) =>
    publishGate({
      req: { user: managerA, context },
      data: { _status: 'published', ...data },
    } as never)

  it('lets the hook’s own publish through', () => {
    expect(() => run({ autoApproval: { scope: 'posts.routine' } })).not.toThrow()
  })

  it('refuses it without the server-set mark — even with the mark in the data', () => {
    expect(() => run({})).toThrow()
    expect(() => run({}, { autoApproval: { scope: 'posts.routine' } })).toThrow()
  })
})

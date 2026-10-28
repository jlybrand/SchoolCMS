import { describe, expect, it } from 'vitest'

import { feedConstraint, syndicationConstraint } from '@/content/syndication'

/**
 * COPE syndication (`02` §6, `03` §2) — which tenants a post appears on.
 *
 * `03` §6.4 invariant 3: syndicated PUBLISHED content is readable cross-tenant by design, and
 * NOTHING ELSE IS. This constraint is where "syndicated" is defined, so the cross-tenant half of
 * that invariant is exactly as wide as it is. The published/public half is the caller's
 * (`src/content/posts.ts`); the "invariant 3" cases in tests/integration/tenant-isolation.test.ts
 * prove the two composed against Postgres, including a stale list under `this-tenant`.
 */

describe('syndicationConstraint', () => {
  it('is exactly the three ways a post reaches a tenant', () => {
    /**
     * Asserted structurally, as `PUBLIC_PAGE_CONSTRAINT` is: a branch that loses its `and` with
     * the scope reads every selected list as district-wide, and an effect-only assertion would
     * need the right fixture to notice.
     */
    expect(syndicationConstraint('B')).toEqual({
      or: [
        { tenant: { equals: 'B' } },
        { 'syndication.scope': { equals: 'district-wide' } },
        {
          and: [
            { 'syndication.scope': { equals: 'selected' } },
            { 'syndication.syndicatedTo': { in: ['B'] } },
          ],
        },
      ],
    })
  })

  it('refuses an empty tenant id rather than building a clause that matches anything', () => {
    expect(() => syndicationConstraint('')).toThrow()
  })
})

/**
 * A feed (Jason, 2026-10-28 — the hybrid): reach is the post's own sharing; boards and tags only
 * NARROW it. Picking District → News on SHS's feed shows District News that is shared with SHS,
 * never all of District News.
 */
describe('feedConstraint', () => {
  const reach = syndicationConstraint('B')
  const live = [{ _status: { equals: 'published' } }, { visibility: { equals: 'public' } }]

  it('with no boards or tags is reach, published and public', () => {
    expect(feedConstraint('B')).toEqual({ and: [reach, ...live] })
  })

  it('narrows by boards and by ANY of the tags — never replacing reach', () => {
    expect(feedConstraint('B', { boards: ['7', '8'], tags: ['3'] })).toEqual({
      and: [reach, ...live, { board: { in: ['7', '8'] } }, { tags: { in: ['3'] } }],
    })
  })

  it('an empty list is no filter, not a filter that matches nothing', () => {
    expect(feedConstraint('B', { boards: [], tags: [] })).toEqual({ and: [reach, ...live] })
  })
})

import type { Where } from 'payload'

/**
 * COPE syndication — which tenants a post appears on (`02` §6, `03` §2).
 *
 * A post lives once, on its own tenant, and is REFERENCED by the others — never copied — so an
 * edit reaches every site that shows it. Three ways a post reaches tenant T:
 *
 *   - it is T's own post;
 *   - its scope is `district-wide`;
 *   - its scope is `selected` and T is in `syndicatedTo`.
 *
 * `03` §6.4 invariant 3 makes this the ONE permitted cross-tenant read, so the read is exactly
 * as wide as this constraint — which is why it is in one place.
 *
 * The list counts only under `selected`. A post switched back to this-tenant keeps its old list
 * in the row; honouring it would leave the post on schools the district just took it off.
 *
 * Published-and-public is NOT decided here; the caller adds it (`src/content/posts.ts`). Kept
 * apart so this file answers one question, and so a syndicated draft is refused by the same
 * clause that refuses an unsyndicated one.
 */

export type SyndicationScope = 'this-tenant' | 'district-wide' | 'selected'

export const SYNDICATION_SCOPES: readonly { value: SyndicationScope; label: string }[] = [
  { value: 'this-tenant', label: 'This site only' },
  { value: 'district-wide', label: 'Every school site' },
  { value: 'selected', label: 'The sites chosen below' },
] as const

/** The posts that reach `tenantId`, as a query. Throws on an empty id rather than matching all. */
export const syndicationConstraint = (tenantId: string): Where => {
  if (tenantId.trim() === '') throw new Error('syndicationConstraint: no tenant id')
  return {
    or: [
      { tenant: { equals: tenantId } },
      { 'syndication.scope': { equals: 'district-wide' } },
      {
        and: [
          { 'syndication.scope': { equals: 'selected' } },
          { 'syndication.syndicatedTo': { in: [tenantId] } },
        ],
      },
    ],
  }
}

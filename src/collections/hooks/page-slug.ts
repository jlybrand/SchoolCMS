import { ValidationError, type CollectionBeforeValidateHook } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { slugify } from '@/lib/slug'

/**
 * Slug derivation and sibling uniqueness for `pages`.
 *
 * Both run as `beforeValidate`, in the order they are listed in the collection config:
 * derive first, then check the derived value for collisions. Reversing them would check a
 * slug the editor never sees.
 */

/**
 * Fills the slug in from the title so an editor never has to know what a slug is — the
 * usability bar in CLAUDE.md is a school manager who attended no training.
 *
 * THE RULE THAT MATTERS is the negative one: the title is used only on CREATE. Renaming a
 * live page must not move its URL, because that breaks every inbound link, every bookmark,
 * and the redirect map assembled during migration (`10` §6). Moving a page has to be a
 * deliberate edit to the slug itself.
 *
 * A hand-typed slug is normalized rather than trusted, so `Bell Schedule!` cannot reach the
 * database as a slug that would need percent-encoding in a URL.
 */
export const deriveSlugFromTitle: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (!data) return data

  const typed = typeof data.slug === 'string' ? data.slug.trim() : ''

  if (typed !== '') return { ...data, slug: slugify(typed) }
  if (operation === 'create' && typeof data.title === 'string') {
    return { ...data, slug: slugify(data.title) }
  }

  return data
}

/**
 * Sibling-slug uniqueness for `pages`.
 *
 * A page's URL is assembled from its ancestor chain, so two siblings sharing a slug put two
 * pages at ONE path. `getPageByPath` then returns whichever row the database orders first —
 * non-deterministic, and cached at the edge once resolved (`02` §5), so the wrong page can
 * stay served long after the mistake.
 *
 * Payload's field-level `unique` cannot express this. Uniqueness is per
 * (tenant, parent, slug): two schools may both have `/about`, and so may two different
 * parents inside one school. Only a query knows.
 *
 * Runs as `beforeValidate` so the failure surfaces as a field error in the admin UI rather
 * than a 500 from a database constraint.
 */
export const uniqueSlugWithinParent: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const slug = typeof data?.slug === 'string' ? data.slug.trim() : ''

  // A partial update that does not touch the slug has nothing to check, and querying on
  // `undefined` matches unpredictably.
  if (slug === '') return data

  const tenant = relationshipIdOf((data?.tenant ?? originalDoc?.tenant) as never)
  const parent = relationshipIdOf((data?.parent ?? originalDoc?.parent) as never)

  /**
   * `exists: false` rather than omitting the clause. Dropping it would compare against
   * every page in the tenant, so a top-level `/about` would collide with a nested
   * `/handbook/about` that shares nothing but a final segment.
   */
  const parentClause =
    parent === null ? { parent: { exists: false } } : { parent: { equals: parent } }

  const { docs } = await req.payload.find({
    collection: 'pages',
    where: {
      and: [{ tenant: { equals: tenant } }, parentClause, { slug: { equals: slug } }],
    },
    limit: 2,
    depth: 0,
    // The platform checking its own invariant, not a user reading data. Scoped by the
    // tenant clause above; without the override a school-manager's own sibling could be
    // invisible to the check and the collision would land anyway.
    overrideAccess: true,
  })

  const selfId = originalDoc?.id === undefined ? null : String(originalDoc.id)
  const clash = docs.find((doc) => String((doc as { id: unknown }).id) !== selfId)

  if (clash) {
    throw new ValidationError({
      errors: [
        {
          path: 'slug',
          message: `A page with the slug "${slug}" already exists here. Pages under the same parent need different slugs, because they would otherwise share a URL.`,
        },
      ],
    })
  }

  return data
}

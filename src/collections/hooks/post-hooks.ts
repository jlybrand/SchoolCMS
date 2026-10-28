import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
} from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { nextFreeSlug } from '@/lib/slug'

/**
 * The `posts` hooks that `pages` has no counterpart for (`03` §2). Slug DERIVATION is shared —
 * `deriveSlugFromTitle` in ./page-slug.ts runs first — and so are the publish gate and the
 * review state.
 */

/**
 * One address per post within its school.
 *
 * A post's URL is its school plus its slug, so two posts on one slug are two posts at one URL.
 * A NEW post is numbered (`picture-day-2`): a title repeating each year is ordinary for news,
 * and a school manager never sees a slug to fix. An UPDATE that collides is refused instead —
 * only the district edits a post's address, and renumbering the one they typed would publish a
 * URL nobody chose.
 */
export const uniquePostSlug: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const slug = typeof data?.slug === 'string' ? data.slug.trim() : ''
  if (!data || slug === '') return data

  const tenant = relationshipIdOf((data.tenant ?? originalDoc?.tenant) as never)

  const { docs } = await req.payload.find({
    collection: 'posts',
    where: {
      and: [{ tenant: { equals: tenant } }, { slug: { like: slug } }],
    },
    pagination: false,
    depth: 0,
    // The platform checking its own invariant, scoped by the tenant clause above.
    overrideAccess: true,
    req,
  })

  const selfId = originalDoc?.id === undefined ? null : String(originalDoc.id)
  const taken = docs
    .filter((doc) => String((doc as { id: unknown }).id) !== selfId)
    .map((doc) => String((doc as { slug?: unknown }).slug))

  if (operation === 'create') return { ...data, slug: nextFreeSlug(slug, taken) }

  if (taken.includes(slug)) {
    throw new ValidationError({
      errors: [
        {
          path: 'slug',
          message: `Another post at this school already uses the address "${slug}". Posts need different addresses, because they would otherwise share a URL.`,
        },
      ],
    })
  }
  return data
}

/**
 * The date a post shows, set the first time it publishes (`03` §2 `publishedDate`).
 *
 * DISPLAY ONLY. Nothing hides a post until this date: a date a school manager could set that
 * withheld a post would be a scheduled publish, which only the district may make (CLAUDE.md
 * rule 3). The field itself is district-only; this fills it when nobody did.
 *
 * An edit to a published post keeps its date — a corrected typo is not news.
 */
export const stampPublishedDate = ({
  data,
  originalDoc,
  now = () => new Date().toISOString(),
}: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown> | undefined
  now?: () => string
}): Record<string, unknown> => {
  if (data._status !== 'published') return data
  if (data.publishedDate || originalDoc?.publishedDate) return data
  return { ...data, publishedDate: now() }
}

export const stampPublishedDateHook: CollectionBeforeChangeHook = ({ data, originalDoc }) =>
  stampPublishedDate({ data, originalDoc })

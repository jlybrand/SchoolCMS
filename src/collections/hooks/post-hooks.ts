import {
  ValidationError,
  type CollectionBeforeChangeHook,
  type CollectionBeforeValidateHook,
} from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { NEEDS_WORDS } from '@/admin/SendForApproval/review-status'
import { toRichText } from '@/content/rich-text'
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

/**
 * An announcement needs words before it is sent or published.
 *
 * Not `required` on the field: "Post an announcement" creates the post from its headline alone,
 * so autosave covers it from the first keystroke (`04` §2.3), as "Add a page" does — and a
 * required body would refuse that create. So the words are required at the two moments that
 * matter: when the school sends it, and when anyone publishes it.
 *
 * A save on a post already waiting is let through; it was checked when it was sent, and a
 * school clearing the words of a waiting post leaves the district a diff that shows exactly that.
 */
export const postNeedsWords = ({
  data,
  originalDoc,
}: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown> | undefined
}): Record<string, unknown> => {
  const sending = data.reviewState === 'submitted' && originalDoc?.reviewState !== 'submitted'
  const publishing = data._status === 'published'
  if (!sending && !publishing) return data

  const body = 'body' in data ? data.body : originalDoc?.body
  if (toRichText(body).length > 0) return data

  throw new ValidationError({
    errors: [
      {
        path: 'body',
        message: NEEDS_WORDS,
      },
    ],
  })
}

export const postNeedsWordsHook: CollectionBeforeChangeHook = ({ data, originalDoc }) =>
  postNeedsWords({ data, originalDoc })

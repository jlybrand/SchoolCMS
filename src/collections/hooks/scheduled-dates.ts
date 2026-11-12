import { ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import { checkPostDates, type PostDateField } from '@/lib/post-dates'

/**
 * Dates on every write (Jason, 2026-11-04): an announcement's Start, Expires and Featured until,
 * and a page's Start (chosen when publishing, 2026-11-11). The rules are `checkPostDates`; this applies them. FIRST in
 * `beforeChange`, so the publish gate and the review state see the write as it will be.
 *
 * - Only a write that CHANGES a date is checked, so dates that have simply passed (a Start that
 *   came, an Expires that took it down) never block a later edit.
 * - A Start already past is stored as nothing: it publishes now.
 * - PUBLISHING WITH A FUTURE START SCHEDULES instead, when nothing is live yet: the write stays a
 *   draft, marked `scheduled`, and the schedule job publishes it at its time. When the post is
 *   already live a publish cannot be turned into a draft without taking it down, so it is refused
 *   with the way out: a live page's or post's change is scheduled as a draft version — by the
 *   approval queue, and by a page's Publish dialog (`src/admin/PagePublish/`, 2026-11-12).
 * - Republishing something that expired clears its Expires, or the job would take it down again.
 *
 * Only the district can write these fields (field-level access), so a school's write never
 * carries one.
 */

/**
 * The schedule job's own writes (`src/collections/endpoints/schedule.ts`): `publish` puts a scheduled post
 * live, `expire` takes one down. `req.context` is filled by server code only — no request can set
 * it — so `publishGate` and `applyReviewState` trust it, as they trust the auto-approval mark.
 */
export const SCHEDULED_RUN = 'scheduledRun'
export type ScheduledRun = 'publish' | 'expire'

export const scheduledRunOf = (req: Pick<PayloadRequest, 'context'>): ScheduledRun | null => {
  const mark = req.context?.[SCHEDULED_RUN]
  return mark === 'publish' || mark === 'expire' ? mark : null
}

const iso = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

/**
 * Is the document on the website now? Read from its RECORD, never from `originalDoc`: Payload
 * hands a hook the newest VERSION, and on a live page with an autosaved edit that is a draft —
 * read from it, "live" said no, the publish became a draft, and the page came down until its
 * Start (Jason's 404, 2026-11-12). A draft save leaves the record published; an unpublish does not.
 */
const isLive = async (
  collection: 'posts' | 'pages',
  id: unknown,
  req: PayloadRequest,
): Promise<boolean> => {
  if (typeof id !== 'string' && typeof id !== 'number') return false
  const record = await req.payload.findByID({
    collection,
    id,
    draft: false,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
    select: { _status: true } as never,
  })
  return (record as { _status?: unknown } | null)?._status === 'published'
}

const makeDatesHook =
  (fields: readonly PostDateField[], noun: 'announcement' | 'page'): CollectionBeforeChangeHook =>
  async ({ data, originalDoc, req }) => {
    if (!data || scheduledRunOf(req)) return data

    const before = (originalDoc ?? {}) as Record<string, unknown>
    const changed = fields.filter((f) => data[f] !== undefined && iso(data[f]) !== iso(before[f]))
    const publishing = data._status === 'published'
    if (changed.length === 0 && !publishing) return data

    const now = new Date()
    const value = (f: PostDateField) => (data[f] !== undefined ? data[f] : before[f])
    // What is checked: every changed date, and any unchanged one still to come — so a new Expires
    // is weighed against a Start already set. Dates that have passed are history.
    const input = Object.fromEntries(
      fields.map((f) => {
        const v = value(f)
        const keep =
          changed.includes(f) || (iso(v) !== null && (iso(v) as string) > now.toISOString())
        return [f, keep ? v : null]
      }),
    )
    const check = checkPostDates(input, now)
    if (!check.ok) {
      throw new ValidationError({
        errors: Object.entries(check.errors).map(([path, message]) => ({ path, message })),
      })
    }

    const next: Record<string, unknown> = { ...data }
    for (const f of changed) next[f] = check.dates[f]

    if (publishing) {
      // An Expires that has passed belongs to the time it was taken down, not to this publish.
      const expires = iso(value('expiresAt'))
      if (expires !== null && expires <= now.toISOString()) next.expiresAt = null

      if (check.schedules) {
        if (await isLive(noun === 'page' ? 'pages' : 'posts', before.id, req)) {
          throw new ValidationError({
            errors: [
              {
                path: 'publishAt',
                // A page has no Start field to clear: its Start is chosen when publishing, and the
                // Publish dialog schedules a live page's change as a draft (`src/admin/PagePublish/`).
                message:
                  noun === 'page'
                    ? 'This page is on the website now, so publishing it with a Start would take it down. Save the change as a scheduled draft instead.'
                    : `This ${noun} is on the website now. Clear Start to publish this change now.`,
              },
            ],
          })
        }
        next._status = 'draft'
        next.reviewState = 'scheduled'
      }
    }
    return next
  }

/** Posts: Start, Expires, Featured until. */
export const postDatesHook = makeDatesHook(
  ['publishAt', 'expiresAt', 'featuredUntil'],
  'announcement',
)

/** Pages: a Start only — chosen when publishing (`src/admin/PagePublish/`). */
export const pageDatesHook = makeDatesHook(['publishAt'], 'page')

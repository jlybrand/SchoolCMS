import { ValidationError, type CollectionBeforeChangeHook, type PayloadRequest } from 'payload'

import { checkPostDates, type PostDateField } from '@/lib/post-dates'

/**
 * An announcement's dates on every write (Jason, 2026-11-04) — Start, Expires, Featured until.
 * The rules are `checkPostDates`; this applies them. FIRST in `beforeChange`, so the publish gate
 * and the review state see the write as it will be.
 *
 * - Only a write that CHANGES a date is checked, so dates that have simply passed (a Start that
 *   came, an Expires that took it down) never block a later edit.
 * - A Start already past is stored as nothing: it publishes now.
 * - PUBLISHING WITH A FUTURE START SCHEDULES instead, when nothing is live yet: the write stays a
 *   draft, marked `scheduled`, and the schedule job publishes it at its time. When the post is
 *   already live a publish cannot be turned into a draft without taking it down, so it is refused
 *   with the way out; the approval queue schedules a live post's change as a draft version.
 * - Republishing something that expired clears its Expires, or the job would take it down again.
 *
 * Only the district can write these fields (field-level access), so a school's write never
 * carries one.
 */

const FIELDS: readonly PostDateField[] = ['publishAt', 'expiresAt', 'featuredUntil']

/**
 * The schedule job's own writes (`src/jobs/post-schedule.ts`): `publish` puts a scheduled post
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

export const postDatesHook: CollectionBeforeChangeHook = ({ data, originalDoc, req }) => {
  if (!data || scheduledRunOf(req)) return data

  const before = (originalDoc ?? {}) as Record<string, unknown>
  const changed = FIELDS.filter((f) => data[f] !== undefined && iso(data[f]) !== iso(before[f]))
  const publishing = data._status === 'published'
  if (changed.length === 0 && !publishing) return data

  const now = new Date()
  const value = (f: PostDateField) => (data[f] !== undefined ? data[f] : before[f])
  // What is checked: every changed date, and any unchanged one still to come — so a new Expires
  // is weighed against a Start already set. Dates that have passed are history.
  const input = Object.fromEntries(
    FIELDS.map((f) => {
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
      if (before._status === 'published') {
        throw new ValidationError({
          errors: [
            {
              path: 'publishAt',
              message:
                'This announcement is on the website now. Clear Start to publish this change now.',
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

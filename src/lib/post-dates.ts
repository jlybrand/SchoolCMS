/**
 * An announcement's dates (Jason, 2026-11-04):
 *
 *   Start (`publishAt`)          when it goes live. In the future, approving SCHEDULES it.
 *   Expires (`expiresAt`)        when it is taken off the website — unpublished entirely.
 *   Featured until (`featuredUntil`)  first in news lists and feeds until then.
 *
 * District only: a school manager cannot set any of them (a Start would let a school publish by
 * waiting). The district sets them when approving, in the queue, or on its own post form.
 * Pure — the queue, the form's validation and the approve endpoint all ask this one function.
 */

export type PostDateField = 'publishAt' | 'expiresAt' | 'featuredUntil'

export type PostDates = Record<PostDateField, string | null>

export type PostDatesInput = Partial<Record<PostDateField, unknown>>

export type PostDatesCheck =
  | { ok: true; dates: PostDates; schedules: boolean }
  | { ok: false; errors: Partial<Record<PostDateField, string>> }

const NOT_A_DATE = 'That isn’t a date and time.'

/** An ISO string, or null for "not set"; undefined when it is set but not a date. */
const parse = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null || value === '') return null
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined
}

export const checkPostDates = (input: PostDatesInput, now: Date): PostDatesCheck => {
  const errors: Partial<Record<PostDateField, string>> = {}
  const read = (field: PostDateField) => {
    const value = parse(input[field])
    if (value === undefined) errors[field] = NOT_A_DATE
    return value ?? null
  }
  const rawStart = read('publishAt')
  const expiresAt = read('expiresAt')
  const featuredUntil = read('featuredUntil')
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  // A Start that has already come is "now": it publishes, and there is nothing to keep.
  const publishAt = rawStart !== null && rawStart > now.toISOString() ? rawStart : null
  const live = publishAt ?? now.toISOString()

  if (expiresAt !== null && expiresAt <= live) {
    errors.expiresAt = 'Choose an expiration after the announcement goes live.'
  }
  if (featuredUntil !== null) {
    if (featuredUntil <= now.toISOString()) errors.featuredUntil = 'Choose a time in the future.'
    else if (expiresAt !== null && featuredUntil > expiresAt) {
      errors.featuredUntil =
        'Featuring can’t outlast the announcement. Choose a time before it expires.'
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return { ok: true, dates: { publishAt, expiresAt, featuredUntil }, schedules: publishAt !== null }
}

/** Whether a post is still featured — first in lists — at `now`. */
export const isFeatured = (featuredUntil: unknown, now: Date): boolean => {
  const until = parse(featuredUntil)
  return typeof until === 'string' && until > now.toISOString()
}

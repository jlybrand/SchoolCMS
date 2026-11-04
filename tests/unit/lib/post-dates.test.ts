import { describe, expect, it } from 'vitest'

import { checkPostDates, isFeatured } from '@/lib/post-dates'

/**
 * An announcement's dates (Jason, 2026-11-04): Start (goes live), Expires (taken off the website
 * entirely) and Featured until (first in lists until then). District only; set when approving or
 * on the district's form. These are the rules for a set of them.
 */

const NOW = new Date('2026-11-04T19:00:00Z')
const at = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000).toISOString()

describe('checkPostDates — what a set of dates means', () => {
  it('none: publish now, nothing else', () => {
    expect(checkPostDates({}, NOW)).toEqual({
      ok: true,
      dates: { publishAt: null, expiresAt: null, featuredUntil: null },
      schedules: false,
    })
  })

  it('treats empty strings as not set — the queue’s untouched inputs', () => {
    expect(checkPostDates({ publishAt: '', expiresAt: '', featuredUntil: '' }, NOW)).toMatchObject({
      ok: true,
      schedules: false,
    })
  })

  it('a future Start schedules', () => {
    expect(checkPostDates({ publishAt: at(24) }, NOW)).toEqual({
      ok: true,
      dates: { publishAt: at(24), expiresAt: null, featuredUntil: null },
      schedules: true,
    })
  })

  it('a Start already past is “now”: it publishes, and is not kept', () => {
    expect(checkPostDates({ publishAt: at(-1) }, NOW)).toEqual({
      ok: true,
      dates: { publishAt: null, expiresAt: null, featuredUntil: null },
      schedules: false,
    })
  })

  it('keeps an Expires and a Featured until in the future', () => {
    expect(
      checkPostDates({ publishAt: at(1), expiresAt: at(48), featuredUntil: at(24) }, NOW),
    ).toMatchObject({
      ok: true,
      dates: { publishAt: at(1), expiresAt: at(48), featuredUntil: at(24) },
    })
  })

  it('refuses an Expires that is not after it goes live', () => {
    expect(checkPostDates({ expiresAt: at(-1) }, NOW)).toEqual({
      ok: false,
      errors: { expiresAt: 'Choose an expiration after the announcement goes live.' },
    })
    expect(checkPostDates({ publishAt: at(24), expiresAt: at(12) }, NOW)).toEqual({
      ok: false,
      errors: { expiresAt: 'Choose an expiration after the announcement goes live.' },
    })
  })

  it('refuses a Featured until already past, or after it expires', () => {
    expect(checkPostDates({ featuredUntil: at(-1) }, NOW)).toEqual({
      ok: false,
      errors: { featuredUntil: 'Choose a time in the future.' },
    })
    expect(checkPostDates({ expiresAt: at(10), featuredUntil: at(20) }, NOW)).toEqual({
      ok: false,
      errors: {
        featuredUntil: 'Featuring can’t outlast the announcement. Choose a time before it expires.',
      },
    })
  })

  it('refuses what is not a date, saying which', () => {
    expect(checkPostDates({ publishAt: 'next week', featuredUntil: 'x' }, NOW)).toEqual({
      ok: false,
      errors: {
        publishAt: 'That isn’t a date and time.',
        featuredUntil: 'That isn’t a date and time.',
      },
    })
  })

  it('reads dates as Payload stores them, and as Date objects', () => {
    expect(checkPostDates({ publishAt: new Date(at(24)) }, NOW)).toMatchObject({
      ok: true,
      schedules: true,
    })
  })
})

describe('isFeatured — first in lists until its time', () => {
  it('is featured only before its time', () => {
    expect(isFeatured(at(1), NOW)).toBe(true)
    expect(isFeatured(at(-1), NOW)).toBe(false)
    expect(isFeatured(null, NOW)).toBe(false)
    expect(isFeatured('nonsense', NOW)).toBe(false)
  })
})

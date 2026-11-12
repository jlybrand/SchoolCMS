import { describe, expect, it } from 'vitest'

import {
  CANCEL_SCHEDULE,
  PUBLISH_NOW,
  publishOfferFor,
  scheduleFor,
  scheduleRefusal,
  toLocalInputValue,
} from '@/admin/PagePublish/page-publish'

/**
 * A page's Start as a choice made when publishing (Jason, 2026-11-11): "Publish now" or
 * "Schedule for…", in place of a Start field in Page settings.
 */

const NOW = new Date('2026-11-11T15:00:00.000Z')
const LATER = '2026-11-12T09:30:00.000Z'

describe('publishOfferFor', () => {
  it('a page not on the site: publish now or schedule', () => {
    expect(publishOfferFor({ live: false, reviewState: null })).toBe('draft')
    expect(publishOfferFor({ live: false, reviewState: 'editing' })).toBe('draft')
  })

  it('a scheduled page: its time, publish now, change or cancel', () => {
    expect(publishOfferFor({ live: false, reviewState: 'scheduled' })).toBe('scheduled')
  })

  it('a page on the site publishes its changes — a live page cannot be scheduled', () => {
    expect(publishOfferFor({ live: true, reviewState: null })).toBe('live')
  })
})

describe('what each choice sends', () => {
  it('“Publish now” clears any Start, so a stored one cannot schedule it instead', () => {
    expect(PUBLISH_NOW).toEqual({ _status: 'published', publishAt: null })
  })

  it('“Schedule” publishes with the Start — the server turns that into a schedule', () => {
    expect(scheduleFor(LATER)).toEqual({ _status: 'published', publishAt: LATER })
  })

  it('“Cancel the schedule” asks for it explicitly, as a draft with no Start', () => {
    expect(CANCEL_SCHEDULE).toEqual({ _status: 'draft', publishAt: null, reviewState: null })
  })
})

describe('scheduleRefusal', () => {
  it('needs a day and time', () => {
    expect(scheduleRefusal('', NOW)).toBe('Choose a day and time.')
    expect(scheduleRefusal('not a date', NOW)).toBe('Choose a day and time.')
  })

  it('needs a time still to come', () => {
    expect(scheduleRefusal('2026-11-10T09:00', NOW)).toBe('Choose a time in the future.')
  })

  it('is null for a time to come', () => {
    expect(scheduleRefusal('2027-01-05T09:00', NOW)).toBeNull()
  })
})

describe('toLocalInputValue', () => {
  it('is what a day-and-time input takes, in the browser’s own time', () => {
    expect(toLocalInputValue(LATER)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(toLocalInputValue(LATER)).toISOString()).toBe(LATER)
  })

  it('is empty for no time', () => {
    expect(toLocalInputValue(null)).toBe('')
    expect(toLocalInputValue('nonsense')).toBe('')
  })
})

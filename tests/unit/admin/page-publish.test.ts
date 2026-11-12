import { describe, expect, it } from 'vitest'

import {
  CANCEL_SCHEDULE,
  dialogHeading,
  headerLabel,
  initialWhen,
  laterHint,
  primaryLabel,
  PUBLISH_NOW,
  publishStateFor,
  publishRequest,
  scheduleFor,
  scheduleRefusal,
  toLocalInputValue,
} from '@/admin/PagePublish/page-publish'

/**
 * A page's Start as a choice made when publishing (Jason, 2026-11-11), in place of a Start field
 * in Page settings — behind ONE Publish button whose dialog asks "now or later", on a page not yet
 * on the site and on a change to one that is (2026-11-12).
 */

const NOW = new Date('2026-11-11T15:00:00.000Z')
const LATER = '2026-11-12T09:30:00.000Z'

const NEW = { live: false, scheduled: false }
const LIVE = { live: true, scheduled: false }
const SCHEDULED = { live: false, scheduled: true }
const LIVE_SCHEDULED = { live: true, scheduled: true }

describe('publishStateFor', () => {
  it('reads whether the page is on the site and whether something is scheduled', () => {
    expect(publishStateFor({ live: false, reviewState: null })).toEqual(NEW)
    expect(publishStateFor({ live: false, reviewState: 'editing' })).toEqual(NEW)
    expect(publishStateFor({ live: true, reviewState: null })).toEqual(LIVE)
    expect(publishStateFor({ live: false, reviewState: 'scheduled' })).toEqual(SCHEDULED)
    expect(publishStateFor({ live: true, reviewState: 'scheduled' })).toEqual(LIVE_SCHEDULED)
  })
})

describe('the one Publish button', () => {
  it('says what it publishes, or when', () => {
    expect(headerLabel(NEW, null)).toBe('Publish')
    expect(headerLabel(LIVE, null)).toBe('Publish changes')
    expect(headerLabel(SCHEDULED, 'Nov 12, 2026, 9:30 AM')).toBe(
      'Scheduled for Nov 12, 2026, 9:30 AM',
    )
    expect(headerLabel(LIVE_SCHEDULED, 'Nov 12, 2026, 9:30 AM')).toBe(
      'Changes scheduled for Nov 12, 2026, 9:30 AM',
    )
  })
})

describe('the Publish dialog', () => {
  it('opens on “Now”, or on “Later” when something is scheduled', () => {
    expect(initialWhen(NEW)).toBe('now')
    expect(initialWhen(LIVE)).toBe('now')
    expect(initialWhen(SCHEDULED)).toBe('later')
    expect(initialWhen(LIVE_SCHEDULED)).toBe('later')
  })

  it('is headed for what it does', () => {
    expect(dialogHeading(NEW)).toBe('Publish this page')
    expect(dialogHeading(LIVE)).toBe('Publish your changes')
    expect(dialogHeading(SCHEDULED)).toBe('Change when this page goes live')
    expect(dialogHeading(LIVE_SCHEDULED)).toBe('Change when your changes go live')
  })

  it('says what “later” means — off the site, or the site as it is', () => {
    expect(laterHint(NEW)).toBe(
      'It stays off the site until then, and goes live on its own at that time.',
    )
    expect(laterHint(LIVE)).toBe(
      'The page on the site stays as it is until then. Your changes go live on their own at that time.',
    )
  })

  it('names its one action for the choice made', () => {
    expect(primaryLabel(NEW, 'now')).toBe('Publish now')
    expect(primaryLabel(NEW, 'later')).toBe('Schedule')
    expect(primaryLabel(LIVE, 'later')).toBe('Schedule')
    expect(primaryLabel(SCHEDULED, 'now')).toBe('Publish now')
    expect(primaryLabel(SCHEDULED, 'later')).toBe('Save the new time')
    expect(primaryLabel(LIVE_SCHEDULED, 'later')).toBe('Save the new time')
  })
})

describe('what each choice sends', () => {
  it('“Publish now” publishes and clears any Start, so a stored one cannot schedule it instead', () => {
    expect(PUBLISH_NOW).toEqual({ _status: 'published', publishAt: null })
  })

  it('“Schedule” saves a DRAFT marked scheduled — so a page on the site stays up until its time', () => {
    expect(scheduleFor(LATER)).toEqual({
      _status: 'draft',
      publishAt: LATER,
      reviewState: 'scheduled',
    })
  })

  it('“Cancel the schedule” asks for it explicitly, as a draft with no Start', () => {
    expect(CANCEL_SCHEDULE).toEqual({ _status: 'draft', publishAt: null, reviewState: null })
  })
})

describe('publishRequest', () => {
  it('“Now” publishes at once, whatever the time box holds', () => {
    expect(publishRequest('now', '', NOW)).toEqual({
      ok: true,
      overrides: PUBLISH_NOW,
      draft: false,
    })
    expect(publishRequest('now', '2026-11-10T09:00', NOW)).toEqual({
      ok: true,
      overrides: PUBLISH_NOW,
      draft: false,
    })
  })

  it('“Later” needs a time still to come', () => {
    expect(publishRequest('later', '', NOW)).toEqual({
      ok: false,
      refusal: 'Choose a day and time.',
    })
    expect(publishRequest('later', '2026-11-10T09:00', NOW)).toEqual({
      ok: false,
      refusal: 'Choose a time in the future.',
    })
  })

  it('“Later” with a time to come is a draft save scheduled for that time', () => {
    expect(publishRequest('later', toLocalInputValue(LATER), NOW)).toEqual({
      ok: true,
      overrides: scheduleFor(LATER),
      draft: true,
    })
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

describe('announcements get the same dialog, in their own words (Jason, 2026-11-12)', () => {
  it('names an announcement where a page is named', () => {
    expect(dialogHeading(NEW, 'announcement')).toBe('Publish this announcement')
    expect(dialogHeading(SCHEDULED, 'announcement')).toBe('Change when this announcement goes live')
    expect(laterHint(LIVE, 'announcement')).toBe(
      'The announcement on the site stays as it is until then. Your changes go live on their own at that time.',
    )
  })

  it('a page by default, as before', () => {
    expect(dialogHeading(NEW)).toBe('Publish this page')
  })
})

describe('the optional comment rides with the publish (Jason, 2026-11-12)', () => {
  it('is added to what either choice sends, trimmed', () => {
    expect(publishRequest('now', '', NOW, '  Checked.  ')).toEqual({
      ok: true,
      overrides: { ...PUBLISH_NOW, changeComment: 'Checked.' },
      draft: false,
    })
    expect(publishRequest('later', toLocalInputValue(LATER), NOW, 'For Monday.')).toEqual({
      ok: true,
      overrides: { ...scheduleFor(LATER), changeComment: 'For Monday.' },
      draft: true,
    })
  })

  it('is left out when empty', () => {
    expect(publishRequest('now', '', NOW, '   ')).toEqual({
      ok: true,
      overrides: PUBLISH_NOW,
      draft: false,
    })
  })
})

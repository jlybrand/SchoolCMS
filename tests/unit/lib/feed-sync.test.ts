import { describe, expect, it } from 'vitest'

import type { FeedEvent } from '@/lib/ical-parse'
import {
  checkFeedUrl,
  feedEventData,
  fingerprintOf,
  isPublicAddress,
  planFeedSync,
} from '@/lib/feed-sync'

/**
 * Feed calendars (Jason, 2026-11-11): the district gives a calendar an iCal or Google address,
 * and an hourly job keeps its events in step with it. These are the pure decisions under that
 * job — which addresses may be fetched at all, and what one fetch changes.
 */

describe('checkFeedUrl — which addresses the server will fetch', () => {
  it.each([
    ['https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics'],
    ['https://example.org/athletics.ics'],
  ])('accepts %s', (url) => {
    expect(checkFeedUrl(url)).toEqual({ ok: true, url })
  })

  it('reads webcal:// as https — it is what "subscribe" buttons hand out', () => {
    expect(checkFeedUrl(' webcal://example.org/cal.ics ')).toEqual({
      ok: true,
      url: 'https://example.org/cal.ics',
    })
  })

  it.each([
    ['plain http', 'http://example.org/cal.ics'],
    ['another scheme', 'ftp://example.org/cal.ics'],
    ['a password in the address', 'https://user:secret@example.org/cal.ics'],
    ['not an address', 'calendar please'],
    ['empty', ''],
  ])('refuses %s, in words', (_label, url) => {
    const check = checkFeedUrl(url)
    expect(check.ok).toBe(false)
    expect(check.ok ? '' : check.error).toMatch(/\w/)
  })

  it.each([
    ['localhost', 'https://localhost/cal.ics'],
    ['a .localhost name', 'https://a.localhost/cal.ics'],
    ['a private IPv4 address', 'https://10.0.0.5/cal.ics'],
    ['the cloud metadata address', 'https://169.254.169.254/latest'],
    ['an IPv6 loopback', 'https://[::1]/cal.ics'],
  ])('refuses %s — the server must not be pointed at its own network', (_label, url) => {
    expect(checkFeedUrl(url)).toEqual({
      ok: false,
      error: 'Use a calendar address on the public internet.',
    })
  })
})

describe('isPublicAddress — a resolved address the server may connect to', () => {
  it.each(['8.8.8.8', '142.250.72.14', '2607:f8b0:4004:c07::64'])('%s is public', (ip) => {
    expect(isPublicAddress(ip)).toBe(true)
  })

  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    'not an ip',
  ])('%s is not', (ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it('172.15 and 172.32 are outside the private block', () => {
    expect(isPublicAddress('172.15.0.1')).toBe(true)
    expect(isPublicAddress('172.32.0.1')).toBe(true)
  })
})

const feedEvent = (overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  uid: 'practice@google.com|2026-11-03T21:00:00.000Z',
  title: 'Soccer practice',
  location: 'Practice field',
  description: 'Bring water.\nPickup at 5:45.',
  allDay: false,
  start: '2026-11-03T21:00:00.000Z',
  end: '2026-11-03T22:30:00.000Z',
  ...overrides,
})

describe('planFeedSync — what one fetch changes', () => {
  const stored = (event: FeedEvent, id: number) => ({
    id,
    feedUid: event.uid,
    fingerprint: fingerprintOf(event),
  })

  it('new in the feed: created; gone from it: removed; unchanged: left alone', () => {
    const kept = feedEvent()
    const gone = feedEvent({ uid: 'gone@google.com|x' })
    const added = feedEvent({ uid: 'new@google.com|y', title: 'Game' })
    const plan = planFeedSync([stored(kept, 1), stored(gone, 2)], [kept, added])
    expect(plan).toEqual({ create: [added], update: [], remove: [2] })
  })

  it('changed in the feed: updated in place, keeping the stored event', () => {
    const before = feedEvent()
    const after = feedEvent({ location: 'Main gym' })
    expect(planFeedSync([stored(before, 1)], [after])).toEqual({
      create: [],
      update: [{ id: 1, event: after }],
      remove: [],
    })
  })

  it('a feed listing one occurrence twice creates it once', () => {
    const e = feedEvent()
    expect(planFeedSync([], [e, e]).create).toEqual([e])
  })

  it('a stored event with no feed id is never touched — it is not the feed’s', () => {
    expect(planFeedSync([{ id: 9, feedUid: null, fingerprint: null }], [])).toEqual({
      create: [],
      update: [],
      remove: [],
    })
  })
})

describe('feedEventData — a feed event as an event to store', () => {
  it('is published on the calendar and site, with notes from the description, one paragraph a line', () => {
    const event = feedEvent()
    expect(feedEventData(event, { tenant: 3, calendar: 9 })).toEqual({
      tenant: 3,
      calendar: 9,
      title: 'Soccer practice',
      location: 'Practice field',
      start: '2026-11-03T21:00:00.000Z',
      end: '2026-11-03T22:30:00.000Z',
      allDay: false,
      repeat: 'none',
      repeatUntil: null,
      notes: {
        root: {
          type: 'root',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: [
            {
              type: 'paragraph',
              version: 1,
              direction: null,
              format: '',
              indent: 0,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'Bring water.',
                  format: 0,
                  mode: 'normal',
                  style: '',
                  detail: 0,
                },
              ],
            },
            {
              type: 'paragraph',
              version: 1,
              direction: null,
              format: '',
              indent: 0,
              children: [
                {
                  type: 'text',
                  version: 1,
                  text: 'Pickup at 5:45.',
                  format: 0,
                  mode: 'normal',
                  style: '',
                  detail: 0,
                },
              ],
            },
          ],
        },
      },
      feedUid: event.uid,
      feedFingerprint: fingerprintOf(event),
      _status: 'published',
    })
  })

  it('no description: no notes', () => {
    expect(
      feedEventData(feedEvent({ description: null }), { tenant: 3, calendar: 9 }).notes,
    ).toBeNull()
  })

  it('the fingerprint changes when anything shown changes, and only then', () => {
    expect(fingerprintOf(feedEvent())).toBe(fingerprintOf(feedEvent()))
    expect(fingerprintOf(feedEvent({ title: 'Other' }))).not.toBe(fingerprintOf(feedEvent()))
    expect(fingerprintOf(feedEvent({ end: null }))).not.toBe(fingerprintOf(feedEvent()))
  })
})

import { describe, expect, it } from 'vitest'

import {
  feedIds,
  firstPerCalendar,
  subscribeOptions,
  subscribeTarget,
  visibleItems,
} from '@/lib/calendar-filter'

/**
 * A calendar block's FILTER (Jason, 2026-11-18): a visitor chooses which of the block's calendars
 * to see, all of them at first. Pure, so the block's server half and its one client half agree.
 */

const item = (key: string, calendarId: string) => ({ key, calendarId })

describe('visibleItems', () => {
  const items = [
    item('a1', 'A'),
    item('b1', 'B'),
    item('a2', 'A'),
    item('c1', 'C'),
    item('b2', 'B'),
  ]

  it('keeps only the chosen calendars’ items, in order', () => {
    expect(visibleItems(items, new Set(['A', 'C'])).map((i) => i.key)).toEqual(['a1', 'a2', 'c1'])
  })

  it('a list’s number counts what is SHOWN, after the filter', () => {
    expect(visibleItems(items, new Set(['B', 'C']), 2).map((i) => i.key)).toEqual(['b1', 'c1'])
  })

  it('nothing chosen shows nothing', () => {
    expect(visibleItems(items, new Set())).toEqual([])
  })

  it('no number is no cap', () => {
    expect(visibleItems(items, new Set(['A', 'B', 'C']))).toHaveLength(5)
  })
})

describe('firstPerCalendar', () => {
  it('keeps each calendar’s first N, in the merged order — so any choice still fills the list', () => {
    const merged = [
      item('a1', 'A'),
      item('a2', 'A'),
      item('a3', 'A'),
      item('b1', 'B'),
      item('a4', 'A'),
      item('b2', 'B'),
      item('b3', 'B'),
    ]
    expect(firstPerCalendar(merged, 2).map((i) => i.key)).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('a number under one keeps nothing', () => {
    expect(firstPerCalendar([item('a1', 'A')], 0)).toEqual([])
  })
})

describe('feedIds — a combined feed’s address, read back', () => {
  it('two or more ids, ascending and distinct: the one address for that set', () => {
    expect(feedIds('3-7-12')).toEqual(['3', '7', '12'])
  })

  it('one id is a calendar’s own feed', () => {
    expect(feedIds('12')).toEqual(['12'])
  })

  it('out of order, repeated, empty or not digits: not an address — one set, one URL', () => {
    for (const bad of ['7-3', '3-3', '', '3--7', 'a-3', '-3']) expect(feedIds(bad), bad).toBeNull()
  })

  it('at most twenty calendars in one feed', () => {
    const many = Array.from({ length: 21 }, (_, i) => String(i + 1)).join('-')
    expect(feedIds(many)).toBeNull()
  })
})

describe('subscribeTarget — what the one Subscribe icon links to (Jason, 2026-11-19)', () => {
  const calendars = [
    { id: '12', name: 'School B', href: 'webcal://b.dd2.org/calendars/12.ics' },
    { id: '3', name: 'District', href: 'webcal://dd2.org/calendars/3.ics' },
  ]
  const combined = 'webcal://b.dd2.org'

  it('one calendar on: its own feed, named for it', () => {
    expect(subscribeTarget(calendars, new Set(['3']), combined)).toEqual({
      href: 'webcal://dd2.org/calendars/3.ics',
      label: 'Subscribe to District',
      name: 'District',
    })
  })

  it('several on: one feed of them, on this site', () => {
    expect(subscribeTarget(calendars, new Set(['3', '12']), combined)).toEqual({
      href: 'webcal://b.dd2.org/calendars/3-12.ics',
      label: 'Subscribe to these 2 calendars',
      name: 'School B, District',
    })
  })

  it('none on: nothing to subscribe to', () => {
    expect(subscribeTarget(calendars, new Set(), combined)).toBeNull()
  })
})

describe('subscribeOptions — where a visitor can subscribe (Jason, 2026-11-19)', () => {
  const options = subscribeOptions('webcal://b.dd2.org/calendars/3-12.ics', 'School B, District')

  it('the standard iCal feed is the https address — what any calendar app takes, copied', () => {
    expect(options.feed).toBe('https://b.dd2.org/calendars/3-12.ics')
  })

  it('Apple Calendar opens the webcal: address', () => {
    expect(options.apple).toBe('webcal://b.dd2.org/calendars/3-12.ics')
  })

  it('Google Calendar adds it by its address (cid)', () => {
    expect(options.google).toBe(
      'https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fb.dd2.org%2Fcalendars%2F3-12.ics',
    )
  })

  it('Outlook adds it from the web, named — personal and Microsoft 365 accounts', () => {
    const query = 'url=https%3A%2F%2Fb.dd2.org%2Fcalendars%2F3-12.ics&name=School+B%2C+District'
    expect(options.outlook).toBe(`https://outlook.live.com/calendar/0/addfromweb?${query}`)
    expect(options.outlook365).toBe(`https://outlook.office.com/calendar/0/addfromweb?${query}`)
  })

  it('a developer’s plain-http host stays http', () => {
    expect(subscribeOptions('webcal://b.localhost:3000/calendars/3.ics', 'B').feed).toBe(
      'http://b.localhost:3000/calendars/3.ics',
    )
  })
})

import { describe, expect, it } from 'vitest'

import { feedNote, feedSource } from '@/lib/feed-source'

describe('feedSource — where an imported calendar comes from, said plainly (Jason, 2026-11-18)', () => {
  it('Google Calendar by name', () => {
    expect(
      feedSource(
        'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics',
      ),
    ).toBe('Google Calendar')
  })

  it('Outlook by name', () => {
    expect(feedSource('https://outlook.office365.com/owa/calendar/x/y/calendar.ics')).toBe(
      'Outlook',
    )
  })

  it('anywhere else: its host, never the full address (it can carry a private token)', () => {
    expect(feedSource('https://www.ics.example.org/athletics.ics?key=secret')).toBe(
      'ics.example.org',
    )
    expect(feedSource('webcal://cal.example.net/feed')).toBe('cal.example.net')
  })

  it('nothing usable: another calendar', () => {
    expect(feedSource('')).toBe('another calendar')
    expect(feedSource(null)).toBe('another calendar')
    expect(feedSource('not a url')).toBe('another calendar')
  })
})

describe('feedNote', () => {
  it('the line beside an imported calendar', () => {
    expect(feedNote('https://calendar.google.com/x.ics')).toBe(
      'This calendar is a feed from Google Calendar. Its events are added there, not here.',
    )
  })
})

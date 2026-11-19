import type { CalendarEvent, RichText, RichTextInline, RichTextList } from '@/content/types'

import { feedSegment } from './calendar-filter'
import { addDays, localDateOf, toRRule } from './recurrence'
import { publicUrlFor } from './review-emails'

/**
 * A calendar as an iCalendar feed (RFC 5545) — what Google, Outlook and Apple Calendar subscribe
 * to (Jason, 2026-11-11). Pure; `src/app/(frontend)/sites/[hostname]/calendar-feed` serves it.
 *
 * TIMES ARE THE DISTRICT'S, WITH A VTIMEZONE. A timed event is written as wall-clock time in
 * `America/New_York` (DTSTART;TZID=…), not UTC: a repeating 4 p.m. meeting must stay at 4 p.m.
 * across daylight saving in the subscriber's app, and a UTC start with an RRULE would drift by an
 * hour twice a year. All-day events are dates, ending the day AFTER the last (ends are exclusive).
 *
 * One event per stored event, repeats as an RRULE (`toRRule`) — the subscriber's app expands
 * them, so the feed stays small however long a repeat runs.
 */

const CRLF = '\r\n'

/**
 * The district's zone as iCalendar needs it: the US rules since 2007. Only this zone is defined —
 * DD2 is one district in one zone (`src/lib/queue-age.ts`).
 */
const VTIMEZONES: Readonly<Record<string, readonly string[]>> = {
  'America/New_York': [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ],
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and line breaks are escaped in TEXT. */
export const escapeText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')

/**
 * RFC 5545 §3.1: a content line is at most 75 octets; longer ones continue on lines that start
 * with a space. Split on characters, never inside a multi-byte one.
 */
export const foldLine = (line: string): string => {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    // The first line holds 75 octets; a continuation holds 74 after its leading space.
    const limit = parts.length === 0 ? 75 : 74
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += bytes
  }
  parts.push(current)
  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join(CRLF)
}

const inlineText = (nodes: readonly RichTextInline[]): string =>
  nodes
    .map((node) =>
      node.kind === 'text' ? node.text : `${inlineText(node.children)} (${node.href})`,
    )
    .join('')

const listText = (list: RichTextList, depth: number): string[] =>
  list.items.flatMap((item, i) => [
    `${'  '.repeat(depth)}${list.ordered ? `${i + 1}.` : '-'} ${inlineText(item.children)}`,
    ...(item.list ? listText(item.list, depth + 1) : []),
  ])

/** Rich text as plain text: blocks apart by a blank line, list items as "- item", links kept. */
export const plainTextOf = (words: RichText): string =>
  words
    .map((block) =>
      block.kind === 'list' ? listText(block, 0).join('\n') : inlineText(block.children),
    )
    .filter((text) => text.trim() !== '')
    .join('\n\n')

const pad = (n: number) => String(n).padStart(2, '0')

/** `20261111T150000Z` */
const utcStamp = (at: Date): string =>
  `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
  `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`

/** `20261204T180000`, the wall-clock time in `timeZone`. */
const wallClock = (iso: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}

const basicDate = (date: string) => date.replace(/-/g, '')

const veventLines = (
  event: CalendarEvent,
  { domain, now, timeZone }: { domain: string; now: Date; timeZone: string },
): string[] => {
  const { timing } = event
  const lines = ['BEGIN:VEVENT', `UID:event-${event.id}@${domain}`, `DTSTAMP:${utcStamp(now)}`]
  if (timing.allDay) {
    const first = localDateOf(timing.start, timeZone)
    const lastRaw = timing.end === null ? first : localDateOf(timing.end, timeZone)
    const last = lastRaw < first ? first : lastRaw
    lines.push(
      `DTSTART;VALUE=DATE:${basicDate(first)}`,
      `DTEND;VALUE=DATE:${basicDate(addDays(last, 1))}`,
    )
  } else {
    lines.push(`DTSTART;TZID=${timeZone}:${wallClock(timing.start, timeZone)}`)
    if (timing.end !== null && timing.end >= timing.start) {
      lines.push(`DTEND;TZID=${timeZone}:${wallClock(timing.end, timeZone)}`)
    }
  }
  const rule = toRRule(timing.repeat, timing.repeatUntil, timeZone)
  if (rule !== null) lines.push(`RRULE:${rule}`)
  lines.push(`SUMMARY:${escapeText(event.title)}`)
  if (event.location !== null) lines.push(`LOCATION:${escapeText(event.location)}`)
  const notes = plainTextOf(event.notes)
  if (notes !== '') lines.push(`DESCRIPTION:${escapeText(notes)}`)
  lines.push('END:VEVENT')
  return lines
}

export type ICalendarInput = {
  /** The calendar's name, shown by the subscriber's app. */
  name: string
  events: readonly CalendarEvent[]
  /** The site's hostname — makes each event's UID unique worldwide and stable across fetches. */
  domain: string
  now: Date
  timeZone: string
}

export const toICalendar = ({ name, events, domain, now, timeZone }: ICalendarInput): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DD2//Website calendars//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    ...(VTIMEZONES[timeZone] ?? []),
    ...events.flatMap((event) => veventLines(event, { domain, now, timeZone })),
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join(CRLF) + CRLF
}

/**
 * Where a calendar's feed is, on its own site (`src/proxy.ts` maps it) — or several calendars'
 * one feed (Jason, 2026-11-19), its ids ascending (`feedSegment`).
 */
export const calendarFeedPath = (calendarIds: string | readonly string[]): string =>
  `/calendars/${typeof calendarIds === 'string' ? calendarIds : feedSegment(calendarIds)}.ics`

/**
 * The address a calendar app subscribes to: the feed on the calendar's OWN site, with the
 * `webcal:` scheme so a click opens the reader's calendar app to subscribe (one URL per calendar,
 * as one per announcement). Built as approval emails build a public address, so a developer's
 * port survives.
 */
export const subscribeUrl = (serverUrl: string, hostname: string, calendarId: string): string =>
  publicUrlFor(serverUrl, hostname, calendarFeedPath(calendarId)).replace(/^https?:/, 'webcal:')

/** A site's `webcal://host[:port]`, for several calendars' one feed on it (Jason, 2026-11-19). */
export const subscribeOrigin = (serverUrl: string, hostname: string): string =>
  publicUrlFor(serverUrl, hostname, '/')
    .replace(/^https?:/, 'webcal:')
    .replace(/\/$/, '')

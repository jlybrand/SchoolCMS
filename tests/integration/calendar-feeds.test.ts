import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLocalReq, type Payload } from 'payload'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { listEventOccurrences } from '@/content/events'
import { FeedFetchError, runCalendarFeeds, syncCalendarFeed } from '@/jobs/calendar-feeds'

import { getTestPayload, isDenied, seed, type Fixtures } from '../helpers/payload'

/**
 * Feed calendars over the real stack (Jason, 2026-11-11) — the sync job, with the fetch replaced
 * by the captured fixtures (`tests/fixtures/ical`), so nothing leaves the machine.
 */

let payload: Payload
let f: Fixtures

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures/ical', name), 'utf8')
const RECURRING = fixture('google-recurring.ics')
const NOW = new Date('2026-11-11T15:00:00.000Z')
const URL = 'https://calendar.google.com/calendar/ical/shs-athletics/public/basic.ics'

let body = RECURRING
const fetchFeed = async () => body

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const req = () => createLocalReq({}, payload)

let calendarId: number

const feedEvents = async () =>
  (
    await payload.find({
      collection: 'events',
      where: { calendar: { equals: calendarId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
      sort: 'start',
    })
  ).docs

const calendar = async () =>
  payload.findByID({ collection: 'calendars', id: calendarId, overrideAccess: true })

const sync = async () => syncCalendarFeed(await req(), await calendar(), { fetchFeed, now: NOW })

beforeEach(async () => {
  body = RECURRING
})

describe('a feed calendar', () => {
  beforeAll(async () => {
    const made = await payload.create({
      collection: 'calendars',
      data: { tenant: f.tenantB, name: 'SHS Athletics', source: 'feed', feedUrl: URL },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    calendarId = made.id as number
  })

  it('setting the address queues a copy within minutes', async () => {
    const { docs } = await payload.find({
      collection: 'payload-jobs',
      where: { taskSlug: { equals: 'calendarFeeds' } },
      overrideAccess: true,
    })
    expect(
      docs.some((job) => (job.input as { calendar?: string })?.calendar === String(calendarId)),
    ).toBe(true)
  })

  it('refuses an address that is not https, or on the server’s own network', async () => {
    for (const feedUrl of ['http://example.org/cal.ics', 'https://10.0.0.5/cal.ics']) {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'calendars',
            data: { tenant: f.tenantB, name: 'Bad', source: 'feed', feedUrl },
            user: f.districtAdmin,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    }
  })

  it('a copy brings in every occurrence, published, and records when', async () => {
    expect(await sync()).toEqual({ created: 6, updated: 0, removed: 0 })
    const events = await feedEvents()
    expect(events.map((e) => e.title)).toEqual([
      'Soccer practice',
      'Soccer practice',
      'Soccer practice (moved indoors)',
      'Soccer practice',
      'Basketball vs. Ashley Ridge',
      'Winter break — no practices',
    ])
    expect(events.every((e) => e._status === 'published' && typeof e.feedUid === 'string')).toBe(
      true,
    )
    expect(await calendar()).toMatchObject({ feedSyncedAt: NOW.toISOString(), feedError: null })
  })

  it('the calendar block shows them', async () => {
    const shown = await listEventOccurrences(
      {
        tenant: {
          id: String(f.tenantB),
          slug: 'b',
          name: 'B',
          hostname: 'b.localhost',
          type: 'school',
        },
        locale: 'en',
      },
      { calendars: [String(calendarId)], range: { from: '2026-12-01', to: '2026-12-31' } },
    )
    expect(shown.map((o) => o.title)).toEqual([
      'Basketball vs. Ashley Ridge',
      'Winter break — no practices',
    ])
  })

  it('copying again changes nothing', async () => {
    expect(await sync()).toEqual({ created: 0, updated: 0, removed: 0 })
  })

  it('a change at the source updates the event in place; a removal removes it', async () => {
    const before = (await feedEvents()).find((e) => e.title === 'Basketball vs. Ashley Ridge')!
    body = RECURRING.replace('LOCATION:Home', 'LOCATION:Away').replace(
      /BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261221[\s\S]*?END:VEVENT\r\n/,
      '',
    )
    expect(await sync()).toEqual({ created: 0, updated: 1, removed: 1 })
    const after = await feedEvents()
    const game = after.find((e) => e.title === 'Basketball vs. Ashley Ridge')!
    expect(game.id).toBe(before.id)
    expect(game.location).toBe('Away')
    expect(after.some((e) => e.title.startsWith('Winter break'))).toBe(false)
    body = RECURRING
    await sync()
  })

  it.each([
    [
      'answers with a sign-in page',
      async () => '<!doctype html><html>Sign in</html>',
      /did not return an iCal calendar/,
    ],
    [
      'cannot be reached',
      async () => {
        throw new FeedFetchError('The calendar’s address did not answer in time.')
      },
      /did not answer in time/,
    ],
  ])(
    'a source that %s keeps the last good copy, and says why',
    async (_label, failing, message) => {
      const count = (await feedEvents()).length
      const result = await syncCalendarFeed(await req(), await calendar(), {
        fetchFeed: failing,
        now: NOW,
      })
      expect(result).toEqual({ error: expect.stringMatching(message) })
      expect(await feedEvents()).toHaveLength(count)
      expect((await calendar()).feedError).toMatch(message)
      await sync()
      expect((await calendar()).feedError).toBeNull()
    },
  )

  it('its events are read-only to everyone — the district too', async () => {
    const [event] = await feedEvents()
    for (const user of [f.districtAdmin, f.managerB]) {
      expect(
        await isDenied(() =>
          payload.update({
            collection: 'events',
            id: event!.id,
            data: { title: 'Edited' },
            user,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
      expect(
        await isDenied(() =>
          payload.delete({ collection: 'events', id: event!.id, user, overrideAccess: false }),
        ),
      ).toBe(true)
    }
  })

  it('nobody adds an event to it by hand', async () => {
    for (const user of [f.districtAdmin, f.managerB]) {
      expect(
        await isDenied(() =>
          payload.create({
            collection: 'events',
            data: {
              tenant: f.tenantB,
              calendar: calendarId,
              title: 'By hand',
              start: '2026-12-04T23:00:00.000Z',
            },
            draft: true,
            user,
            overrideAccess: false,
          }),
        ),
      ).toBe(true)
    }
  })

  it('nobody can set a feed id through the API', async () => {
    const made = await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantB,
        title: 'Pretend feed event',
        start: '2026-12-04T23:00:00.000Z',
        feedUid: 'forged',
      } as never,
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(made.feedUid ?? null).toBeNull()
  })

  it('the copy does not fill the activity log', async () => {
    const ids = (await feedEvents()).map((e) => String(e.id))
    const { totalDocs } = await payload.count({
      collection: 'audit-events',
      where: { and: [{ contentType: { equals: 'events' } }, { documentId: { in: ids } }] },
      overrideAccess: true,
    })
    expect(totalDocs).toBe(0)
  })

  it('the hourly run copies every feed calendar', async () => {
    body = RECURRING.replace('LOCATION:Home', 'LOCATION:Neutral site')
    await runCalendarFeeds(await req(), { fetchFeed, now: NOW })
    const game = (await feedEvents()).find((e) => e.title === 'Basketball vs. Ashley Ridge')
    expect(game?.location).toBe('Neutral site')
  })

  it('turned back to local, the feed’s events go and hand-added ones are allowed again', async () => {
    await payload.update({
      collection: 'calendars',
      id: calendarId,
      data: { source: 'local' },
      user: f.districtAdmin,
      overrideAccess: false,
    })
    expect(await feedEvents()).toHaveLength(0)
    const made = await payload.create({
      collection: 'events',
      data: {
        tenant: f.tenantB,
        calendar: calendarId,
        title: 'By hand now',
        start: '2026-12-04T23:00:00.000Z',
      },
      draft: true,
      user: f.managerB,
      overrideAccess: false,
    })
    expect(made.title).toBe('By hand now')
  })
})

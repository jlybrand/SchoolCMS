import { lookup } from 'node:dns/promises'

import type { PayloadRequest, TaskConfig } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { CALENDAR_FEEDS_TASK, FEED_SYNC } from '@/collections/hooks/event-hooks'
import { checkFeedUrl, feedEventData, isPublicAddress, planFeedSync } from '@/lib/feed-sync'
import { parseFeed } from '@/lib/ical-parse'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

/**
 * Feed calendars, kept in step with their source (Jason, 2026-11-11).
 *
 * Every hour, and within minutes of a new or changed address (`queueFeedSync`), each calendar
 * whose events come from an outside address is fetched, read (`parseFeed` — repeats expanded, a
 * year back to two years ahead), and its events brought in line (`planFeedSync`): new ones
 * created, changed ones updated in place, gone ones removed. Feed events are published and
 * read-only (`src/access/events.ts`); like every event they skip approval.
 *
 * KEEP THE LAST GOOD COPY. A fetch or read that fails changes no event: the calendar records the
 * problem in words (`feedError`) and keeps showing what it had. A source that answers with a
 * sign-in page instead of a calendar is a failure, not an empty calendar (`NotACalendarError`).
 *
 * THE SYNC'S WRITES ARE MARKED (`req.context.feedSync`): no activity-log entry and no per-event
 * revalidation for each of a feed's events. The public pages show the change on their hourly
 * refresh — this job runs outside a request, where Next cannot revalidate anyway
 * (`src/collections/endpoints/schedule.ts` explains).
 */

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 3
const DAYS_BACK = 365
const DAYS_AHEAD = 730
const DAY_MS = 24 * 60 * 60 * 1000

export type FetchFeed = (url: string) => Promise<string>

/** Plain words for the calendar's "Last problem" — what a district admin can act on. */
export class FeedFetchError extends Error {}

/** Every address `host` resolves to must be public — checked before each connection. */
const assertPublicHost = async (host: string): Promise<void> => {
  let addresses: { address: string }[]
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new FeedFetchError(
      'The calendar’s address could not be found. Check it is typed correctly.',
    )
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
    throw new FeedFetchError('Use a calendar address on the public internet.')
  }
}

const readCapped = async (response: Response): Promise<string> => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new FeedFetchError('The calendar is too large to copy (over 5 MB).')
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/**
 * Fetches a feed from the public internet only: `https`, every hop's host resolved and checked,
 * redirects followed by hand (at most three) so a redirect cannot lead into the server's own
 * network, a time limit and a size limit.
 */
export const fetchPublicFeed: FetchFeed = async (address) => {
  let url = address
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const check = checkFeedUrl(url)
    if (!check.ok) throw new FeedFetchError(check.error)
    await assertPublicHost(new URL(check.url).hostname.replace(/^\[|\]$/g, ''))
    let response: Response
    try {
      response = await fetch(check.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'text/calendar, */*;q=0.5', 'user-agent': 'DD2 calendar sync' },
      })
    } catch {
      throw new FeedFetchError('The calendar’s address did not answer in time.')
    }
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) break
      url = new URL(next, check.url).toString()
      continue
    }
    if (!response.ok) {
      throw new FeedFetchError(
        response.status === 404
          ? 'Nothing was found at the calendar’s address. Check it is typed correctly.'
          : `The calendar’s address answered with an error (${response.status}). Check the calendar is public.`,
      )
    }
    return readCapped(response)
  }
  throw new FeedFetchError('The calendar’s address redirected too many times.')
}

type FeedCalendar = { id: number | string; tenant?: unknown; feedUrl?: unknown }

export type SyncResult = { created: number; updated: number; removed: number } | { error: string }

/** One feed calendar, brought in line with its source. Never throws: a failure is recorded. */
export const syncCalendarFeed = async (
  req: PayloadRequest,
  calendar: FeedCalendar,
  { fetchFeed = fetchPublicFeed, now = new Date() }: { fetchFeed?: FetchFeed; now?: Date } = {},
): Promise<SyncResult> => {
  const context = { [FEED_SYNC]: true }
  const record = (data: { feedSyncedAt?: string; feedError: string | null }) =>
    req.payload.update({
      collection: 'calendars',
      id: calendar.id,
      data: data as never,
      overrideAccess: true,
      req,
      context,
    })

  let events
  try {
    const body = await fetchFeed(String(calendar.feedUrl ?? ''))
    events = parseFeed(body, {
      range: {
        from: new Date(now.getTime() - DAYS_BACK * DAY_MS),
        to: new Date(now.getTime() + DAYS_AHEAD * DAY_MS),
      },
      timeZone: DISTRICT_TIME_ZONE,
    })
  } catch (err) {
    const error =
      err instanceof FeedFetchError || (err as Error).name === 'NotACalendarError'
        ? (err as Error).message
        : 'The calendar could not be copied. It will be tried again within the hour.'
    req.payload.logger.warn(
      `calendarFeeds: calendar ${String(calendar.id)}: ${(err as Error).message}`,
    )
    await record({ feedError: error })
    return { error }
  }

  const { docs: stored } = await req.payload.find({
    collection: 'events',
    where: { and: [{ calendar: { equals: calendar.id } }, { feedUid: { exists: true } }] },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: { feedUid: true, feedFingerprint: true },
  })
  const plan = planFeedSync(
    stored.map((doc) => ({
      id: doc.id,
      feedUid: typeof doc.feedUid === 'string' ? doc.feedUid : null,
      fingerprint: typeof doc.feedFingerprint === 'string' ? doc.feedFingerprint : null,
    })),
    events,
  )

  const tenant = relationshipIdOf(calendar.tenant as never)
  const where = { tenant: tenant ?? '', calendar: calendar.id }
  for (const event of plan.create) {
    await req.payload.create({
      collection: 'events',
      data: feedEventData(event, where) as never,
      overrideAccess: true,
      req,
      context,
    })
  }
  for (const { id, event } of plan.update) {
    await req.payload.update({
      collection: 'events',
      id,
      data: feedEventData(event, where) as never,
      overrideAccess: true,
      req,
      context,
    })
  }
  if (plan.remove.length > 0) {
    await req.payload.delete({
      collection: 'events',
      where: { id: { in: plan.remove } },
      overrideAccess: true,
      req,
      context,
    })
  }
  await record({ feedSyncedAt: now.toISOString(), feedError: null })
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length }
}

/** Every feed calendar — or one, when the sync was queued for it. */
export const runCalendarFeeds = async (
  req: PayloadRequest,
  options: { only?: string; fetchFeed?: FetchFeed; now?: Date } = {},
): Promise<void> => {
  const { docs } = await req.payload.find({
    collection: 'calendars',
    where: {
      and: [
        { source: { equals: 'feed' } },
        ...(options.only ? [{ id: { equals: options.only } }] : []),
      ],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  for (const calendar of docs) {
    await syncCalendarFeed(req, calendar as unknown as FeedCalendar, options)
  }
}

export const calendarFeedsTask: TaskConfig = {
  slug: CALENDAR_FEEDS_TASK,
  label: 'Copy feed calendars from their addresses',
  retries: 0,
  inputSchema: [{ name: 'calendar', type: 'text' }],
  // Hourly, a quarter past — away from the digest on the hour.
  schedule: [{ cron: '15 * * * *', queue: 'default' }],
  handler: async ({ input, req }) => {
    const only = (input as { calendar?: unknown } | undefined)?.calendar
    await runCalendarFeeds(req, typeof only === 'string' && only !== '' ? { only } : {})
    return { output: {} }
  },
}

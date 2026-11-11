import {
  ValidationError,
  type Payload,
  type CollectionAfterChangeHook,
  type CollectionBeforeChangeHook,
  type CollectionBeforeDeleteHook,
  type CollectionBeforeValidateHook,
  type PayloadRequest,
} from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { checkEventDates } from '@/lib/event-dates'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

/**
 * The hooks `calendars` and `events` need that no other collection has (Jason, 2026-10-28 and
 * 2026-11-11). Review, publishing and the audit are shared with pages and posts.
 */

/** How the DISTRICT sees a calendar, picking across every site: "Site · Calendar". */
export const calendarLabel = (site: unknown, name: unknown): string => {
  const s = typeof site === 'string' ? site.trim() : ''
  const n = typeof name === 'string' ? name.trim() : ''
  return s === '' || s === n ? n : `${s} · ${n}`
}

const siteName = async (tenant: string | null, req: PayloadRequest): Promise<string | null> => {
  if (tenant === null) return null
  const site = await req.payload.findByID({
    collection: 'tenants',
    id: tenant,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  const name = (site as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : null
}

/** A calendar's district label follows its site and its name. */
export const labelCalendar: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const tenant = relationshipIdOf((data.tenant ?? originalDoc?.tenant) as never)
  const name = data.name ?? originalDoc?.name
  return { ...data, label: calendarLabel(await siteName(tenant, req), name) }
}

/**
 * Each site's own calendar is made with the site (Jason, 2026-10-28: "each site gets its own
 * main calendar automatically"). Named after the site; the district can rename it.
 */
export const makeMainCalendar: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  await req.payload.create({
    collection: 'calendars',
    data: { tenant: doc.id, name: String(doc.name ?? 'Calendar'), isMain: true },
    overrideAccess: true,
    req,
  })
  return doc
}

/**
 * Gives every site that has none its own calendar — for sites made before calendars existed
 * (`pnpm calendars:backfill`, and the seed). Returns the slugs it made one for. Idempotent.
 */
export const ensureMainCalendars = async (payload: Payload): Promise<string[]> => {
  const { docs: sites } = await payload.find({
    collection: 'tenants',
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  const made: string[] = []
  for (const site of sites) {
    const { totalDocs } = await payload.count({
      collection: 'calendars',
      where: { and: [{ tenant: { equals: site.id } }, { isMain: { equals: true } }] },
      overrideAccess: true,
    })
    if (totalDocs > 0) continue
    await payload.create({
      collection: 'calendars',
      data: { tenant: site.id, name: String(site.name ?? 'Calendar'), isMain: true },
      overrideAccess: true,
    })
    made.push(String(site.slug))
  }
  return made
}

/**
 * A site's own calendar stays as long as the site does: every event a school adds lands on it
 * when no other is chosen (`eventCalendarIsThisSites`). Other calendars may go.
 */
export const keepMainCalendar: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const calendar = await req.payload.findByID({
    collection: 'calendars',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  if ((calendar as { isMain?: unknown } | null)?.isMain === true) {
    throw new ValidationError({
      errors: [
        { path: 'name', message: 'A site’s own calendar can’t be deleted. Rename it instead.' },
      ],
    })
  }
}

/** The site's own calendar, read as the platform. */
export const mainCalendarOf = async (
  tenant: string,
  req: PayloadRequest,
): Promise<string | null> => {
  const { docs } = await req.payload.find({
    collection: 'calendars',
    where: { and: [{ tenant: { equals: tenant } }, { isMain: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return docs[0] ? String(docs[0].id) : null
}

/**
 * One calendar per event, and one of the event's OWN site (Jason, 2026-10-28). An event sent with
 * no calendar goes on the site's own one, so a school with one calendar never has to choose.
 * Another site's calendar is refused — the picker's filter is the first layer, this the second,
 * as for a post's board.
 */
export const eventCalendarIsThisSites: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const tenant = relationshipIdOf((data.tenant ?? originalDoc?.tenant) as never)
  const chosen = data.calendar === undefined ? originalDoc?.calendar : data.calendar
  const calendarId = relationshipIdOf((chosen ?? null) as never)

  if (calendarId === null) {
    const main = tenant === null ? null : await mainCalendarOf(tenant, req)
    if (main !== null) return { ...data, calendar: /^\d+$/.test(main) ? Number(main) : main }
    throw new ValidationError({
      errors: [{ path: 'calendar', message: 'Choose which calendar this goes on.' }],
    })
  }

  const calendar = await req.payload.findByID({
    collection: 'calendars',
    id: calendarId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  if (
    calendar &&
    tenant !== null &&
    relationshipIdOf((calendar as { tenant?: unknown }).tenant as never) === tenant
  ) {
    // A feed calendar's events come from its address, and only the sync writes them.
    if ((calendar as { source?: unknown }).source === 'feed' && !isFeedSync(req)) {
      throw new ValidationError({
        errors: [
          {
            path: 'calendar',
            message:
              'This calendar is copied from another calendar’s address. Add the event there, or choose another calendar.',
          },
        ],
      })
    }
    return data
  }
  throw new ValidationError({
    errors: [{ path: 'calendar', message: 'Choose one of this site’s calendars.' }],
  })
}

/** The rules in `src/lib/event-dates.ts`, on the merged result of every write. */
export const eventDatesHook: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  const field = (name: string) => (name in data ? data[name] : originalDoc?.[name])
  const check = checkEventDates(
    {
      start: field('start'),
      end: field('end'),
      allDay: field('allDay'),
      repeat: field('repeat'),
      repeatUntil: field('repeatUntil'),
    },
    DISTRICT_TIME_ZONE,
  )
  if (check.ok) return data
  throw new ValidationError({
    errors: Object.entries(check.errors).map(([path, message]) => ({ path, message })),
  })
}

/** The feed sync's own writes (`src/jobs/calendar-feeds.ts`) — marked by server code only. */
export const FEED_SYNC = 'feedSync'
export const isFeedSync = (req: PayloadRequest): boolean => req.context?.[FEED_SYNC] === true

/**
 * Wraps an `events` afterChange/afterDelete hook so the hourly feed sync skips it: an outside
 * calendar's hundreds of events are not district activity, and revalidating every site once per
 * event would be hundreds of revalidations. The sync records its run on the calendar instead
 * (`feedSyncedAt`, `feedError`), and the public site catches up on its hourly refresh.
 */
export const unlessFeedSync =
  <T extends { req: PayloadRequest; doc?: unknown }>(hook: (args: T) => unknown) =>
  (args: T) =>
    isFeedSync(args.req) ? args.doc : hook(args)

/** The task slug, shared with `src/jobs/calendar-feeds.ts` (which imports these hooks' module). */
export const CALENDAR_FEEDS_TASK = 'calendarFeeds'

/**
 * A new or changed feed address is copied within minutes, not at the next hour: the sync is
 * queued for this calendar, and Payload's runner (every five minutes) picks it up.
 */
export const queueFeedSync: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (doc.source !== 'feed') return doc
  const changed =
    previousDoc?.source !== 'feed' || previousDoc?.feedUrl !== doc.feedUrl || !doc.feedSyncedAt
  if (!changed || isFeedSync(req)) return doc
  await req.payload.jobs.queue({
    task: CALENDAR_FEEDS_TASK,
    input: { calendar: String(doc.id) },
    req,
  } as never)
  return doc
}

/**
 * A calendar turned back to local keeps only the events added here: the feed's are removed, as
 * the platform (they are read-only to everyone else).
 */
export const dropFeedEvents: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (doc.source === 'feed' || previousDoc?.source !== 'feed') return doc
  await req.payload.delete({
    collection: 'events',
    where: { and: [{ calendar: { equals: doc.id } }, { feedUid: { exists: true } }] },
    overrideAccess: true,
    req,
    context: { [FEED_SYNC]: true },
  })
  return doc
}

import { getCalendarFeed, getCombinedCalendarFeed } from '@/content/events'
import { getTenantByHostname } from '@/content/tenants'
import { feedIds } from '@/lib/calendar-filter'
import { toICalendar } from '@/lib/ical'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { localDateOf } from '@/lib/recurrence'

/**
 * A calendar's iCal feed (Jason, 2026-11-11) — `/calendars/<id>.ics` on the calendar's own site,
 * what Google, Outlook and Apple Calendar subscribe to.
 *
 * Reached only through the proxy's rewrite (src/proxy.ts), so `hostname` is the normalized
 * request Host. Another site's calendar, an unknown one and an unknown host all 404 alike: one
 * address per calendar, and no default tenant (`02` §4.1). Published events only — the content
 * layer decides.
 *
 * SEVERAL CALENDARS' ONE FEED (Jason, 2026-11-19): `/calendars/3-7-12.ics` — what a calendar
 * block's one Subscribe link points at when more than one of its calendars is on. Served on any
 * site (the block's page's), any site's calendars, as the block shows them; only the one address
 * of each set (`feedIds`: ascending, distinct, at most twenty), and 404 if any id is unknown.
 *
 * Cached like a page (`02` §5): calendar apps poll, and the database is not in that path. An
 * event's publish revalidates every site (`revalidateEvent`); otherwise hourly.
 */
export const revalidate = 3600

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hostname: string; id: string }> },
) {
  const { hostname, id } = await params
  const tenant = await getTenantByHostname(decodeURIComponent(hostname))
  const ids = feedIds(id)
  if (!tenant || ids === null) return new Response('Not found', { status: 404 })

  const now = new Date()
  const today = localDateOf(now.toISOString(), DISTRICT_TIME_ZONE)
  const feed =
    ids.length === 1
      ? await getCalendarFeed(tenant, ids[0]!, today)
      : await getCombinedCalendarFeed(ids, today)
  if (!feed) return new Response('Not found', { status: 404 })

  return new Response(
    toICalendar({
      name: feed.name,
      events: feed.events,
      domain: tenant.hostname,
      now,
      timeZone: DISTRICT_TIME_ZONE,
    }),
    {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `inline; filename="calendar-${id}.ics"`,
      },
    },
  )
}

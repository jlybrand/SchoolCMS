import { getCalendarFeed } from '@/content/events'
import { getTenantByHostname } from '@/content/tenants'
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
  if (!tenant || !/^\d+$/.test(id)) return new Response('Not found', { status: 404 })

  const now = new Date()
  const feed = await getCalendarFeed(tenant, id, localDateOf(now.toISOString(), DISTRICT_TIME_ZONE))
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

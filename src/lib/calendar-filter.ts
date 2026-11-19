/**
 * A calendar block's FILTER (Jason, 2026-11-18): a visitor chooses which of the block's calendars
 * to see — all of them at first. PURE, shared by the block's server half (`resolvePageBlocks`)
 * and its one client half (`CalendarFilter`), so the two agree on what a list holds.
 */

type OnCalendar = { readonly calendarId: string }

/** The chosen calendars' items, in order, at most `limit` of them (a list's number). */
export const visibleItems = <T extends OnCalendar>(
  items: readonly T[],
  shown: ReadonlySet<string>,
  limit?: number,
): T[] => {
  const kept = items.filter((item) => shown.has(item.calendarId))
  return limit === undefined ? kept : kept.slice(0, Math.max(0, limit))
}

/**
 * Each calendar's first `limit` items, in the merged order. A list block keeps this many, not
 * `limit` in all: whichever calendars a visitor leaves on, their next `limit` events are there to
 * show — one shared cap would let a busy calendar crowd a quiet one out of the page entirely.
 */
export const firstPerCalendar = <T extends OnCalendar>(items: readonly T[], limit: number): T[] => {
  const counts = new Map<string, number>()
  return items.filter((item) => {
    const seen = counts.get(item.calendarId) ?? 0
    if (seen >= limit) return false
    counts.set(item.calendarId, seen + 1)
    return true
  })
}

/**
 * ONE SUBSCRIBE LINK per block (Jason, 2026-11-19), following the filter: several calendars share
 * one feed, `/calendars/3-7-12.ics`, its ids ascending and distinct so each set has one address.
 * At most twenty, so a crafted address cannot ask for the whole district at once.
 */
const MAX_FEED_CALENDARS = 20

/** The ids' address segment: ascending (as numbers), distinct. */
export const feedSegment = (ids: readonly string[]): string =>
  [...new Set(ids)].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)).join('-')

/** A feed address's ids, or null when it is not the one address of its set. */
export const feedIds = (segment: string): string[] | null => {
  if (!/^\d+(?:-\d+)*$/.test(segment)) return null
  const ids = segment.split('-')
  if (ids.length > MAX_FEED_CALENDARS) return null
  return feedSegment(ids) === segment ? ids : null
}

export type SubscribableCalendar = { id: string; name: string; href: string }

/**
 * What the Subscribe icon links to: one calendar on → its own feed on its own site; several →
 * their one feed on this site (`combinedOrigin`, `webcal://host[:port]`); none → nothing.
 */
export const subscribeTarget = (
  calendars: readonly SubscribableCalendar[],
  shown: ReadonlySet<string>,
  combinedOrigin: string,
): { href: string; label: string; name: string } | null => {
  const on = calendars.filter((c) => shown.has(c.id))
  if (on.length === 0) return null
  if (on.length === 1)
    return { href: on[0]!.href, label: `Subscribe to ${on[0]!.name}`, name: on[0]!.name }
  return {
    href: `${combinedOrigin}/calendars/${feedSegment(on.map((c) => c.id))}.ics`,
    label: `Subscribe to these ${on.length} calendars`,
    name: on.map((c) => c.name).join(', '),
  }
}

/**
 * Where a visitor can subscribe to a feed (Jason, 2026-11-19: "an iCal feed, standard, Google,
 * Outlook, Apple"), from its `webcal:` address:
 *
 *   - `feed`: the standard iCal address (https; http on a developer's `localhost`), to copy into
 *     any calendar app;
 *   - `apple`: the `webcal:` address itself, which Apple Calendar (and most desktop apps) open;
 *   - `google`: Google Calendar's "add by URL", the address as `cid`;
 *   - `outlook` / `outlook365`: Outlook's "add from web", for personal and Microsoft 365 accounts,
 *     named so the calendar reads as ours in the visitor's list.
 *
 * Google and Outlook fetch the feed from their own servers, so they work for the public sites,
 * not for a developer's `localhost`.
 */
export const subscribeOptions = (webcal: string, name: string) => {
  const local = /^webcal:\/\/(?:[^/:]+\.)?localhost(?::\d+)?\//.test(webcal)
  const feed = webcal.replace(/^webcal:/, local ? 'http:' : 'https:')
  const outlook = new URLSearchParams({ url: feed, name }).toString()
  return {
    feed,
    apple: webcal,
    google: `https://calendar.google.com/calendar/render?${new URLSearchParams({ cid: webcal }).toString()}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?${outlook}`,
    outlook365: `https://outlook.office.com/calendar/0/addfromweb?${outlook}`,
  }
}

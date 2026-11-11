import { toGridMonths, weekdayNames } from '@/lib/calendar-view'
import { localizedPath } from '@/lib/locales'
import { monthRange, monthsFrom } from '@/lib/month-grid'
import { NEWS_PATH, toNewsItems } from '@/lib/post-url'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'
import { addDays, localDateOf } from '@/lib/recurrence'

import { subscribeUrl } from '@/lib/ical'

import { listCalendarRefs, listEventOccurrences } from './events'
import { listPosts } from './posts'
import type {
  CalendarBlock,
  ContentContext,
  FeedBlock,
  PageBlock,
  ResolvedCalendarBlock,
  ResolvedPageBlock,
} from './types'

/**
 * THE RESOLVE PASS (Jason, 2026-10-28; `03` §3.2).
 *
 * ============================================================================
 * STORED SETTINGS IN, READY-TO-RENDER BLOCKS OUT. ON THE PAYLOAD SIDE.
 * ============================================================================
 *
 * A block never fetches (CLAUDE.md rule 1), so a block whose content is an editor-configured
 * query — a news feed now; a staff list, a document list, a gallery later — gets its data here,
 * between the pure mapper (`toPageBlocks`, which the migration runs with no CMS) and the
 * renderer (`BlockList`, which accepts only `ResolvedPageBlock`s, so skipping this does not
 * compile).
 *
 * Finalsite's post element is the same idea — a saved board/tag/count query rendered on the
 * server — with the query moved out of the component into the content layer.
 *
 * EMPTINESS IS DECIDED HERE: a data block with nothing to show is dropped, so no heading sits
 * over an empty box (Jason, 2026-10-28). Runs at build or revalidate time, never per visitor.
 */

type Options = {
  /** `NEXT_PUBLIC_SERVER_URL` — how a shared announcement links to its home site (`postHref`). */
  serverUrl: string
  /** The district's date today, `YYYY-MM-DD`. Defaults to the clock; tests pass one. */
  today?: string
}

/** How far ahead a calendar looks: a list's next events within a year; a grid's twelve months. */
const LIST_DAYS_AHEAD = 365
const GRID_MONTHS = 12

const resolveFeed = async (ctx: ContentContext, block: FeedBlock, { serverUrl }: Options) => {
  const posts = await listPosts(ctx, { boards: block.boards, tags: block.tags, limit: block.limit })
  if (posts.length === 0) return null
  return {
    kind: 'feed' as const,
    id: block.id,
    heading: block.heading,
    items: toNewsItems(posts, { siteTenantId: ctx.tenant.id, locale: ctx.locale, serverUrl }),
    moreHref: localizedPath(NEWS_PATH, ctx.locale),
  }
}

/**
 * A calendar's events (Jason, 2026-11-11). A LIST is the next events from today, at most the
 * block's number, and is dropped when there are none — the feed's rule. A GRID is this month and
 * the eleven after, and is always shown: an empty month is still a calendar.
 *
 * Pages revalidate hourly, so "today" moves on without a publish.
 */
const resolveCalendar = async (
  ctx: ContentContext,
  block: CalendarBlock,
  today: string,
  serverUrl: string,
): Promise<ResolvedCalendarBlock | null> => {
  const subscribe = (await listCalendarRefs(block.calendars)).map((ref) => ({
    name: ref.name,
    href: subscribeUrl(serverUrl, ref.hostname, ref.id),
  }))
  const base = { kind: 'calendar' as const, id: block.id, heading: block.heading, subscribe }
  if (block.display === 'list') {
    const events = await listEventOccurrences(ctx, {
      calendars: block.calendars,
      range: { from: today, to: addDays(today, LIST_DAYS_AHEAD) },
      limit: block.limit,
    })
    return events.length === 0 ? null : { ...base, display: 'list', events }
  }
  const months = monthsFrom(today, GRID_MONTHS)
  const range = { from: monthRange(months[0]!).from, to: monthRange(months.at(-1)!).to }
  const events = await listEventOccurrences(ctx, { calendars: block.calendars, range })
  return {
    ...base,
    display: 'grid',
    weekdays: weekdayNames(ctx.locale),
    months: toGridMonths(events, { months, today, locale: ctx.locale }),
    events,
  }
}

export const resolvePageBlocks = async (
  ctx: ContentContext,
  blocks: readonly PageBlock[],
  options: Options,
): Promise<ResolvedPageBlock[]> => {
  const today = options.today ?? localDateOf(new Date().toISOString(), DISTRICT_TIME_ZONE)
  const resolved = await Promise.all(
    blocks.map(async (block): Promise<ResolvedPageBlock | null> => {
      switch (block.kind) {
        case 'feed':
          return resolveFeed(ctx, block, options)
        case 'calendar':
          return resolveCalendar(ctx, block, today, options.serverUrl)
        case 'columns':
          // A column's data blocks — a feed in a column — resolve as a page's do.
          return {
            ...block,
            columns: await Promise.all(
              block.columns.map(async (column) => ({
                heading: column.heading,
                blocks: await resolvePageBlocks(ctx, column.blocks, { ...options, today }),
              })),
            ),
          }
        default:
          return block
      }
    }),
  )
  return resolved.filter((block): block is ResolvedPageBlock => block !== null)
}

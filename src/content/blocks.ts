import { relationshipIdOf } from '@/access/predicates'
import { toEmbedTarget } from '@/lib/embed-url'
import { toSafeHref } from '@/lib/href'
import { NO_PAGE_PATHS, pathOfPage, type PagePaths } from './page-tree'
import { toRichText } from './rich-text'
import type {
  AccordionBlock,
  AccordionItem,
  Card,
  CardGridBlock,
  CallToActionBlock,
  ChildPageNavBlock,
  DividerBlock,
  EmbedBlock,
  CalendarBlock,
  StaffListBlock,
  FeedBlock,
  PageBlock,
  RichTextPageBlock,
} from './types'

/**
 * Payload `layout` rows -> DD2 blocks (`02` §11, ADR-5, `03` §3).
 *
 * ============================================================================
 * THE MAPPING HAPPENS HERE, ONCE. Nothing downstream sees a `blockType`.
 * ============================================================================
 *
 * A pure function over JSON — no Payload import, no I/O — so the Phase 9 migration mappers
 * (`10` §5) can reuse it to turn extracted Finalsite sections into blocks without standing
 * up a CMS.
 *
 * IT MUST NEVER THROW, for a reason `rich-text.ts` shares and this file makes sharper: the
 * `layout` array's shape changes every time a block joins or leaves the register (`03` §3.1).
 * A deploy will eventually render content authored against a newer schema than it knows —
 * during a rollback, or mid-rollout across 28 tenants. An unrecognised block becomes nothing;
 * a build that dies on one takes every site with it.
 *
 * WHAT IT DROPS, AND WHY DROPPING BEATS RESCUING. A block that cannot meet its accessibility
 * contract is removed rather than rendered degraded. A call to action with no destination is
 * a button that goes nowhere; one with no label is announced as "link" and nothing else
 * (WCAG 2.4.4). Rendering either would put a visible, broken affordance on a published page,
 * where it reads as working software. The same instinct as `rich-text.ts` unwrapping an
 * anchor that has no `href`.
 *
 * EVERY DESTINATION AN EDITOR TYPED GOES THROUGH `toSafeHref`, the allowlist the menus use. The
 * admin validates the same rule, but a migration or a direct database write only has to get
 * past one of the two — so this file does not trust that the validator ran.
 */

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A trimmed string, or null. Whitespace-only is nothing — an editor cleared the field. */
const str = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Payload writes `id` on every array row. A row without one is still content, so the index
 * stands in rather than dropping the block — but the two cannot collide, hence the prefix.
 */
const idOf = (row: Row, index: number): string => str(row.id) ?? `block-${index}`

/**
 * Where a button or a card goes (Jason, 2026-10-29): a PAGE takes the path it has today, so a
 * rename or a move never breaks it, and any address stored beside it is ignored; an address
 * goes through `toSafeHref`; `none` (cards only) is no link. A row with no `linkType` predates
 * link types and is an address.
 */
const hrefOf = (row: Row, paths: PagePaths): string | null => {
  if (row.linkType === 'page') return pathOfPage(row.page, paths)
  if (row.linkType === 'none') return null
  return toSafeHref(row.href)
}

const toRichTextBlock = (row: Row, index: number, paths: PagePaths): RichTextPageBlock | null => {
  const content = toRichText(row.content, paths)

  /**
   * `RichText` renders null for an empty document, so an empty block would occupy a slot in
   * the layout and show nothing — invisible to the editor who left it there, and a hole in
   * the vertical rhythm `Stack` owns.
   */
  if (content.length === 0) return null

  return { kind: 'richText', id: idOf(row, index), content }
}

const toCallToAction = (row: Row, index: number, paths: PagePaths): CallToActionBlock | null => {
  // A page with no current path leaves the button going nowhere, so the block goes too.
  const href = hrefOf(row, paths)
  const linkLabel = str(row.linkLabel)

  // The link is the block. See the file header.
  if (href === null || linkLabel === null) return null

  return {
    kind: 'callToAction',
    id: idOf(row, index),
    heading: str(row.heading),
    text: str(row.text),
    href,
    linkLabel,
    newTab: row.newTab === true,
  }
}

/** Rows of a nested array field, or an empty list. Same tolerance as the outer array. */
const rowsOf = (value: unknown): Row[] =>
  Array.isArray(value) ? value.filter((row): row is Row => isRow(row)) : []

const toAccordion = (row: Row, index: number, paths: PagePaths): AccordionBlock | null => {
  const items = rowsOf(row.items)
    .map((item): AccordionItem | null => {
      const heading = str(item.heading)
      const content = toRichText(item.content, paths)

      /**
       * A disclosure with no question is an unlabelled control; one with no answer opens onto
       * nothing. Neither is worth rendering, and both are things an editor leaves behind
       * mid-edit rather than intends.
       */
      if (heading === null || content.length === 0) return null

      return { heading, content }
    })
    .filter((item): item is AccordionItem => item !== null)

  if (items.length === 0) return null

  return { kind: 'accordion', id: idOf(row, index), heading: str(row.heading), items }
}

const toCardGrid = (row: Row, index: number, paths: PagePaths): CardGridBlock | null => {
  const cards = rowsOf(row.cards)
    .map((card): Card | null => {
      // The title is the card's name — without one there is nothing to announce or link.
      const title = str(card.title)
      if (title === null) return null

      /**
       * An unsafe destination, or a page with no current path, costs the card its link, not the
       * card — the link is optional.
       */
      return { title, text: str(card.text), href: hrefOf(card, paths) }
    })
    .filter((card): card is Card => card !== null)

  if (cards.length === 0) return null

  return { kind: 'cardGrid', id: idOf(row, index), heading: str(row.heading), cards }
}

/**
 * A menu of the pages beneath this one.
 *
 * THE ONE BLOCK WHOSE EMPTINESS THIS FILE CANNOT JUDGE. Every other block is dropped here
 * when it has nothing to show, because everything it shows is in its own row. This one's
 * content is `Page.children`, resolved in `pages.ts` and threaded to the renderer as a prop —
 * so whether it is empty is not knowable here, and `ChildPageNav` drops it instead.
 *
 * Which is the whole point of the shape: this stays a pure function over JSON, and therefore
 * stays reusable by the Phase 9 migration mappers with no CMS running (`10` §5).
 */
const toChildPageNav = (row: Row, index: number): ChildPageNavBlock => ({
  kind: 'childPageNav',
  id: idOf(row, index),
  heading: str(row.heading),
})

/**
 * A third-party video.
 *
 * TWO WAYS TO BE DROPPED, and both are conformance rather than tidiness:
 *
 *   - **Not an allowlisted video.** `toEmbedTarget` returns null for any host DD2 has not
 *     allowlisted, for a malformed id, and for a non-http scheme. `07` §6 makes an embed DD2's
 *     accessibility obligation and requires a current VPAT from the vendor before it can be
 *     one, so an unknown host is a policy failure, not a typo to display.
 *   - **No title.** It is the frame's accessible name (WCAG 4.1.2). An untitled frame is
 *     announced as "frame" and nothing else — the same reasoning that drops an unnamed link.
 *
 * The block is also where the raw URL stops. Nothing downstream sees what the editor typed.
 */
const toEmbed = (row: Row, index: number): EmbedBlock | null => {
  const target = toEmbedTarget(str(row.url))
  const title = str(row.title)

  if (target === null || title === null) return null

  return { kind: 'embed', id: idOf(row, index), src: target.src, href: target.href, title }
}

/**
 * The one block with no content to validate, and therefore the only one that can never be
 * dropped for being empty.
 */
const toDivider = (row: Row, index: number): DividerBlock => ({
  kind: 'divider',
  id: idOf(row, index),
})

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) => relationshipIdOf(v as never)).filter((v): v is string => v !== null)
    : []

/** How many a feed shows: 1-10, 5 unless set. A homepage feed is a glance, not an archive. */
const feedLimit = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(10, Math.max(1, Math.floor(value)))
    : 5

/**
 * A news feed's SETTINGS (Jason, 2026-10-28). The announcements are not here: they are loaded by
 * `resolvePageBlocks`, which keeps this mapper pure.
 *
 * No boards: dropped. It would read as "every board", which nobody chose — the admin requires at
 * least one, so this is a migration or a direct write.
 */
const toFeed = (row: Row, index: number): FeedBlock | null => {
  const boards = ids(row.boards)
  if (boards.length === 0) return null
  return {
    kind: 'feed',
    id: idOf(row, index),
    heading: str(row.heading),
    boards,
    tags: ids(row.tags),
    limit: feedLimit(row.limit),
  }
}

/** How many a calendar list shows: 1-50, 5 unless set. */
const calendarLimit = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(50, Math.max(1, Math.floor(value)))
    : 5

/**
 * A calendar's SETTINGS (Jason, 2026-11-11). The events are not here: they are loaded by
 * `resolvePageBlocks`, as a feed's announcements are. No calendars: dropped, for the feed's
 * reason — it would read as "every calendar", which nobody chose.
 */
const toCalendar = (row: Row, index: number): CalendarBlock | null => {
  const calendars = ids(row.calendars)
  if (calendars.length === 0) return null
  return {
    kind: 'calendar',
    id: idOf(row, index),
    heading: str(row.heading),
    calendars,
    display: row.display === 'grid' ? 'grid' : 'list',
    limit: calendarLimit(row.limit),
  }
}

/**
 * A staff list's SETTINGS (Jason, 2026-11-13): the one group or sub-group it shows. The staff
 * are loaded by `resolvePageBlocks`, as a calendar's events are. No group: dropped — nobody
 * chose whose staff.
 */
const toStaffList = (row: Row, index: number): StaffListBlock | null => {
  const [group] = ids(row.group === undefined || row.group === null ? [] : [row.group])
  if (!group) return null
  return { kind: 'staffList', id: idOf(row, index), heading: str(row.heading), group }
}

/** At most this many columns are rendered; the schema allows no more. */
const MAX_COLUMNS = 3

/**
 * Columns (Jason, 2026-11-04). Each column's blocks map exactly as a page's do — an unknown block
 * inside one becomes nothing. An empty column is KEPT, so the others stay where they were put;
 * columns with nothing in any of them are dropped, like any other empty block.
 */
const toColumns = (row: Row, index: number, paths: PagePaths): PageBlock | null => {
  const rows = Array.isArray(row.columns) ? row.columns.filter(isRow).slice(0, MAX_COLUMNS) : []
  const columns = rows.map((column) => ({
    heading: str(column.heading),
    // Not `toPageBlocks` on columns-in-columns: the schema offers none, and this keeps it so.
    blocks: toPageBlocks(column.content, paths).filter((block) => block.kind !== 'columns'),
  }))
  if (columns.every((column) => column.blocks.length === 0)) return null
  return { kind: 'columns', id: idOf(row, index), heading: str(row.heading), columns }
}

/**
 * One entry per block in the register (`03` §3.1). A `blockType` absent from this table is
 * dropped — which is the forward-compatibility property, not an oversight.
 */
const MAPPERS: Record<string, (row: Row, index: number, paths: PagePaths) => PageBlock | null> = {
  richText: toRichTextBlock,
  callToAction: toCallToAction,
  accordion: toAccordion,
  cardGrid: toCardGrid,
  childPageNav: toChildPageNav,
  embed: toEmbed,
  divider: toDivider,
  feed: toFeed,
  calendar: toCalendar,
  staffList: toStaffList,
  columns: toColumns,
}

/**
 * Maps a page's `layout` array to DD2 blocks, preserving author order.
 *
 * Accepts `unknown` for the same reason `toRichText` does: the caller has a value from the
 * database whose shape is a promise nobody can enforce, and a stricter signature would push
 * the defensive checks out to every call site.
 *
 * `paths` is the site's page id -> current path (`page-tree.ts`), for buttons, cards and words
 * that link to a page. Still pure: the caller looks the paths up.
 */
export const toPageBlocks = (value: unknown, paths: PagePaths = NO_PAGE_PATHS): PageBlock[] => {
  if (!Array.isArray(value)) return []

  return value
    .map((row, index) => {
      if (!isRow(row)) return null
      const map = typeof row.blockType === 'string' ? MAPPERS[row.blockType] : undefined
      return map ? map(row, index, paths) : null
    })
    .filter((block): block is PageBlock => block !== null)
}

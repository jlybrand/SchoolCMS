import { toRichText } from './rich-text'
import type {
  AccordionBlock,
  AccordionItem,
  Card,
  CardGridBlock,
  CallToActionBlock,
  DividerBlock,
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

const toRichTextBlock = (row: Row, index: number): RichTextPageBlock | null => {
  const content = toRichText(row.content)

  /**
   * `RichText` renders null for an empty document, so an empty block would occupy a slot in
   * the layout and show nothing — invisible to the editor who left it there, and a hole in
   * the vertical rhythm `Stack` owns.
   */
  if (content.length === 0) return null

  return { kind: 'richText', id: idOf(row, index), content }
}

const toCallToAction = (row: Row, index: number): CallToActionBlock | null => {
  const href = str(row.href)
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

const toAccordion = (row: Row, index: number): AccordionBlock | null => {
  const items = rowsOf(row.items)
    .map((item): AccordionItem | null => {
      const heading = str(item.heading)
      const content = toRichText(item.content)

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

const toCardGrid = (row: Row, index: number): CardGridBlock | null => {
  const cards = rowsOf(row.cards)
    .map((card): Card | null => {
      // The title is the card's name — without one there is nothing to announce or link.
      const title = str(card.title)
      if (title === null) return null

      return { title, text: str(card.text), href: str(card.href) }
    })
    .filter((card): card is Card => card !== null)

  if (cards.length === 0) return null

  return { kind: 'cardGrid', id: idOf(row, index), heading: str(row.heading), cards }
}

/**
 * The one block with no content to validate, and therefore the only one that can never be
 * dropped for being empty.
 */
const toDivider = (row: Row, index: number): DividerBlock => ({
  kind: 'divider',
  id: idOf(row, index),
})

/**
 * One entry per block in the register (`03` §3.1). A `blockType` absent from this table is
 * dropped — which is the forward-compatibility property, not an oversight.
 */
const MAPPERS: Record<string, (row: Row, index: number) => PageBlock | null> = {
  richText: toRichTextBlock,
  callToAction: toCallToAction,
  accordion: toAccordion,
  cardGrid: toCardGrid,
  divider: toDivider,
}

/**
 * Maps a page's `layout` array to DD2 blocks, preserving author order.
 *
 * Accepts `unknown` for the same reason `toRichText` does: the caller has a value from the
 * database whose shape is a promise nobody can enforce, and a stricter signature would push
 * the defensive checks out to every call site.
 */
export const toPageBlocks = (value: unknown): PageBlock[] => {
  if (!Array.isArray(value)) return []

  return value
    .map((row, index) => {
      if (!isRow(row)) return null
      const map = typeof row.blockType === 'string' ? MAPPERS[row.blockType] : undefined
      return map ? map(row, index) : null
    })
    .filter((block): block is PageBlock => block !== null)
}

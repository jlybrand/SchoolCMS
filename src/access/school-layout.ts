/**
 * What a school manager may change in a page's components (Jason, 2026-11-04 — "level B").
 *
 *   SIMPLE components (`SCHOOL_BLOCKS`): edit, add, remove, reorder — freely.
 *   Every OTHER component is the district's: Columns, News feed, Embed, Section menu, and any
 *   block added later until it is named here. A school may not edit one, remove one, add one, or
 *   move one past another. Simple components may move around them.
 *   INSIDE the district's Columns the same rules apply again: a school may write in a column,
 *   but the columns themselves — their number, their headings, the set's heading — stay as set.
 *
 * PURE, and the one place this is decided. `schoolLayoutGate` (`src/collections/hooks/`) applies
 * it to every write a school makes, on every route — the admin's component picker offering only
 * the simple ones is convenience, this is the rule. A school's change still goes through approval.
 *
 * Deny by default: a component this file does not know is the district's.
 */

export const SCHOOL_BLOCKS: ReadonlySet<string> = new Set([
  'richText',
  'callToAction',
  'cardGrid',
  'accordion',
  'divider',
  // Jason, 2026-11-13: a school picks from its own library, where alt text is already required.
  'image',
  // Jason, 2026-11-16: one of the school's own library folders (checked on save).
  'documentList',
])

export type SchoolLayoutCheck = { ok: true } | { ok: false; reason: string }

const REFUSED: SchoolLayoutCheck = {
  ok: false,
  reason:
    'Part of this page is set by the district and can’t be changed here. Undo that change, or ask the district web team.',
}

type Row = Record<string, unknown>

const rows = (value: unknown): Row[] =>
  Array.isArray(value)
    ? value.filter((r): r is Row => typeof r === 'object' && r !== null && !Array.isArray(r))
    : []

const isSimple = (row: Row): boolean =>
  typeof row.blockType === 'string' && SCHOOL_BLOCKS.has(row.blockType)

/**
 * A value as plain data with its keys in order and its empty keys gone — so a component that
 * comes back from the form exactly as it was compares equal, however the keys are ordered and
 * whether an unset field arrives as `null` or not at all.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null && v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}

/** Whether two components hold the same thing — also how the approval diff spots an edit. */
export const sameComponent = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

/** The district's Columns: the frame unchanged, each column's contents by the same rules. */
const columnsKept = (before: Row, after: Row): boolean => {
  const { columns: beforeCols, ...beforeFrame } = before
  const { columns: afterCols, ...afterFrame } = after
  if (!sameComponent(beforeFrame, afterFrame)) return false
  const b = rows(beforeCols)
  const a = rows(afterCols)
  if (b.length !== a.length) return false
  return b.every((column, i) => {
    const { content: beforeContent, ...beforeHead } = column
    const { content: afterContent, ...afterHead } = a[i]!
    return sameComponent(beforeHead, afterHead) && levelKept(beforeContent, afterContent)
  })
}

/** One list of components: the district's ones in the same order, each unchanged. */
const levelKept = (before: unknown, after: unknown): boolean => {
  const lockedBefore = rows(before).filter((r) => !isSimple(r))
  const lockedAfter = rows(after).filter((r) => !isSimple(r))
  if (lockedBefore.length !== lockedAfter.length) return false
  return lockedBefore.every((b, i) => {
    const a = lockedAfter[i]!
    if (b.id === undefined || b.id === null || b.id !== a.id) return false
    if (b.blockType !== a.blockType) return false
    return b.blockType === 'columns' ? columnsKept(b, a) : sameComponent(b, a)
  })
}

/** Whether a school manager's write keeps the district's components as they were. */
export const checkSchoolLayout = (before: unknown, after: unknown): SchoolLayoutCheck =>
  levelKept(before, after) ? { ok: true } : REFUSED

/**
 * What a school's component picker offers: the simple components, plus the kinds already in
 * `current`. Payload refuses to save a block its picker does not allow, so without the second
 * part a school could not save a page the district had put a news feed on. Offering "News feed"
 * there does not let a school add one — `checkSchoolLayout` still refuses that.
 */
export const schoolPalette = (current: unknown): string[] => [
  ...new Set([
    ...SCHOOL_BLOCKS,
    ...rows(current)
      .map((row) => row.blockType)
      .filter((type): type is string => typeof type === 'string'),
  ]),
]

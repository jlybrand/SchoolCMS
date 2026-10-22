import { toRichText } from '@/content/rich-text'
import type { RichTextBlock, RichTextInline } from '@/content/types'

/**
 * The inline diff the district approves from (`04` §4.2).
 *
 * "Field-by-field for typed content and as a rendered comparison for rich text." Typed fields
 * are listed only when they changed, in words rather than stored values. The body is compared
 * BLOCK by block — paragraph, heading, list — so a one-line edit to a long page reads as one
 * removed and one added line, not as two whole documents side by side.
 *
 * `live` is the published page, or null if it has never been published; `proposed` is the
 * version waiting for approval. Pure and total: a malformed body reads as empty.
 *
 * District-only fields (`layout`, `publishAt`, `requiresTranslationReview`) are absent because
 * a school cannot write them; the queue diffs what a school can propose.
 */

export type FieldChange = {
  field: string
  label: string
  before: string | null
  after: string | null
}

export type BlockChange = {
  change: 'added' | 'removed'
  kind: RichTextBlock['kind']
  /** A paragraph or heading is one line; a list is one line per item. */
  lines: string[]
}

export type BodyDiff = { changes: BlockChange[]; unchanged: number }

export type PageDiff = { isNew: boolean; fields: FieldChange[]; body: BodyDiff | null }

type Doc = Record<string, unknown>

const PAGE_TYPES: Record<string, string> = {
  standard: 'Standard',
  about: 'About',
  contact: 'Contact',
  staff: 'Staff',
  calendar: 'Calendar',
  documents: 'Documents',
  composed: 'Composed (district only)',
}

const VISIBILITY: Record<string, string> = { public: 'Anyone', staff: 'Staff only' }

const TOP = 'Top of the site'

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

const group = (doc: Doc, key: string): Doc => {
  const value = doc[key]
  return value !== null && typeof value === 'object' ? (value as Doc) : {}
}

/** The parent as a comparable id and a readable name. */
const parentOf = (value: unknown): { id: string | null; name: string } => {
  if (value === null || value === undefined || value === '') return { id: null, name: TOP }
  if (typeof value === 'object') {
    const { id, title } = value as { id?: unknown; title?: unknown }
    return { id: id === undefined ? null : String(id), name: textOf(title) ?? `Page ${String(id)}` }
  }
  return { id: String(value), name: `Page ${String(value)}` }
}

type FieldSpec = {
  field: string
  label: string
  /** The value to compare. */
  key: (doc: Doc) => string | null
  /** The value to show. Defaults to the key. */
  show?: (doc: Doc) => string | null
  /** Listed on a new page even when empty. */
  always?: boolean
}

const FIELDS: FieldSpec[] = [
  { field: 'title', label: 'Title', key: (d) => textOf(d.title), always: true },
  {
    field: 'slug',
    label: 'Address',
    key: (d) => textOf(d.slug),
    show: (d) => (textOf(d.slug) ? `/${textOf(d.slug)}` : null),
    always: true,
  },
  {
    field: 'pageType',
    label: 'Page type',
    key: (d) => textOf(d.pageType),
    show: (d) => PAGE_TYPES[String(d.pageType)] ?? textOf(d.pageType),
    always: true,
  },
  {
    field: 'visibility',
    label: 'Who can see it',
    key: (d) => textOf(d.visibility),
    show: (d) => VISIBILITY[String(d.visibility)] ?? textOf(d.visibility),
    always: true,
  },
  {
    field: 'parent',
    label: 'Placed under',
    key: (d) => parentOf(d.parent).id,
    show: (d) => parentOf(d.parent).name,
    always: true,
  },
  {
    field: 'meta.title',
    label: 'Title in search results',
    key: (d) => textOf(group(d, 'meta').title),
  },
  {
    field: 'meta.description',
    label: 'Description in search results',
    key: (d) => textOf(group(d, 'meta').description),
  },
]

const inlineText = (children: RichTextInline[]): string =>
  children
    .map((child) =>
      child.kind === 'text'
        ? child.text
        : `${child.children.map((c) => c.text).join('')} (${child.href})`,
    )
    .join('')
    .trim()

type KeyedBlock = { key: string; change: Omit<BlockChange, 'change'> }

const keyed = (block: RichTextBlock): KeyedBlock => ({
  // The whole block, marks and links included: a formatting change is a change.
  key: JSON.stringify(block),
  change: {
    kind: block.kind,
    lines:
      block.kind === 'list'
        ? block.items.map((item) => inlineText(item.children))
        : [inlineText(block.children)],
  },
})

const blocksOf = (state: unknown): KeyedBlock[] => {
  try {
    return toRichText(state).map(keyed)
  } catch {
    return []
  }
}

/** Longest common subsequence over block keys; what is outside it was removed or added. */
const diffBlocks = (before: KeyedBlock[], after: KeyedBlock[]): BodyDiff | null => {
  if (before.length === 0 && after.length === 0) return null

  const n = before.length
  const m = after.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        before[i]!.key === after[j]!.key
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const changes: BlockChange[] = []
  let unchanged = 0
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && before[i]!.key === after[j]!.key) {
      unchanged += 1
      i += 1
      j += 1
    } else if (j < m && (i >= n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      // Removals print before the addition that replaces them, so a rewording reads in order.
      if (i < n && lcs[i + 1]![j]! === lcs[i]![j + 1]!) {
        changes.push({ change: 'removed', ...before[i]!.change })
        i += 1
      } else {
        changes.push({ change: 'added', ...after[j]!.change })
        j += 1
      }
    } else {
      changes.push({ change: 'removed', ...before[i]!.change })
      i += 1
    }
  }

  return changes.length === 0 ? null : { changes, unchanged }
}

export const diffPage = (live: Doc | null, proposed: Doc): PageDiff => {
  const fields: FieldChange[] = []
  for (const spec of FIELDS) {
    const show = spec.show ?? spec.key
    if (live === null) {
      const after = show(proposed)
      if (after !== null || spec.always)
        fields.push({ field: spec.field, label: spec.label, before: null, after })
      continue
    }
    if (spec.key(live) !== spec.key(proposed)) {
      fields.push({
        field: spec.field,
        label: spec.label,
        before: show(live),
        after: show(proposed),
      })
    }
  }

  return {
    isNew: live === null,
    fields,
    body: diffBlocks(live === null ? [] : blocksOf(live.body), blocksOf(proposed.body)),
  }
}

import { toRichText } from '@/content/rich-text'
import { sameComponent } from '@/access/school-layout'
import { postPath } from '@/lib/post-url'
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
 * District-only fields (`publishAt`, `requiresTranslationReview`) are absent because a school
 * cannot write them; the queue diffs what a school can propose. A page has no body: its words
 * are Text sections, diffed with the rest of its SECTIONS (`diffLayout`) — the body diff is an
 * announcement's.
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

export type PageDiff = {
  isNew: boolean
  fields: FieldChange[]
  body: BodyDiff | null
  /** The page's sections (components) that changed — absent when none did. */
  sections?: SectionsDiff
}

type Doc = Record<string, unknown>

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
        : block.kind === 'rule'
          ? ['(a horizontal line)']
          : block.kind === 'image'
            ? [`(an image${block.image?.alt ? `: ${block.image.alt}` : ''})`]
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

/** An announcement's typed fields (`03` §2 `posts`). It lives at `/news/{slug}` on its site. */
/** A related row as the queue hands it over: `{ id, title }`, or a bare id. */
const named = (value: unknown): { id: string; name: string } | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    const { id, title } = value as { id?: unknown; title?: unknown }
    if (id === undefined || id === null) return null
    return { id: String(id), name: textOf(title) ?? `#${String(id)}` }
  }
  return { id: String(value), name: `#${String(value)}` }
}

/** Tags in name order, so the order they were ticked in is not a change. */
const tagsOf = (doc: Doc) =>
  (Array.isArray(doc.tags) ? doc.tags : [])
    .map(named)
    .filter((t): t is { id: string; name: string } => t !== null)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))

const POST_FIELDS: FieldSpec[] = [
  { field: 'title', label: 'Headline', key: (d) => textOf(d.title), always: true },
  {
    field: 'slug',
    label: 'Address',
    key: (d) => textOf(d.slug),
    show: (d) => (textOf(d.slug) ? postPath(textOf(d.slug)!) : null),
    always: true,
  },
  {
    field: 'board',
    label: 'Board',
    key: (d) => named(d.board)?.id ?? null,
    show: (d) => named(d.board)?.name ?? null,
    always: true,
  },
  {
    field: 'tags',
    label: 'Tags',
    key: (d) =>
      tagsOf(d)
        .map((t) => t.id)
        .sort()
        .join(',') || null,
    show: (d) =>
      tagsOf(d)
        .map((t) => t.name)
        .join(', ') || null,
  },
  { field: 'excerpt', label: 'Summary', key: (d) => textOf(d.excerpt) },
  {
    /** The image (Jason, 2026-11-13), named by its library title as the queue hands it over. */
    field: 'heroImage',
    label: 'Image',
    key: (d) => named(d.heroImage)?.id ?? null,
    show: (d) => named(d.heroImage)?.name ?? null,
  },
  {
    field: 'visibility',
    label: 'Who can see it',
    key: (d) => textOf(d.visibility),
    show: (d) => VISIBILITY[String(d.visibility)] ?? textOf(d.visibility),
    always: true,
  },
]

const diffFields = (specs: FieldSpec[], live: Doc | null, proposed: Doc): PageDiff => {
  const fields: FieldChange[] = []
  for (const spec of specs) {
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

export const diffPage = (live: Doc | null, proposed: Doc): PageDiff => {
  const diff = diffFields(FIELDS, live, proposed)
  const sections = diffLayout(live === null ? [] : live.layout, proposed.layout)
  return sections.changes.length === 0 ? diff : { ...diff, sections }
}

// ---------------------------------------------------------------------------------------------
// A page's components (Jason, 2026-11-04: schools compose)
// ---------------------------------------------------------------------------------------------

export type SectionChange = {
  change: 'added' | 'removed' | 'changed' | 'moved'
  /** The kind of section, in the form's words: "Text", "Button", "Cards". */
  kind: string
  /** What it says — its words, heading or label — shortened. Empty for a divider. */
  summary: string
  /** Where it is when not on the page itself: "In column 2 of “Ways to help”". */
  where: string | null
  /** For changed Text: the lines that changed, as the body diff shows them. */
  words: BodyDiff | null
}

export type SectionsDiff = { changes: SectionChange[]; unchanged: number }

const KINDS: Record<string, string> = {
  richText: 'Text',
  callToAction: 'Button',
  cardGrid: 'Cards',
  accordion: 'Accordion',
  divider: 'Divider',
  columns: 'Columns',
  feed: 'News feed',
  embed: 'Video',
  childPageNav: 'Section menu',
  calendar: 'Calendar',
  staffList: 'Staff list',
  documentList: 'Document list',
  image: 'Image',
  hero: 'Hero',
}

type Section = Record<string, unknown>

const sectionsOf = (value: unknown): Section[] =>
  Array.isArray(value)
    ? value.filter((r): r is Section => typeof r === 'object' && r !== null && !Array.isArray(r))
    : []

const shorten = (text: string): string => (text.length > 80 ? `${text.slice(0, 80)}…` : text)

/** What a section says, in one line. */
const summaryOf = (section: Section): string => {
  const items = (key: string, field: string) =>
    sectionsOf(section[key])
      .map((row) => textOf(row[field]))
      .filter((t): t is string => t !== null)
  switch (section.blockType) {
    case 'richText':
      return shorten(blocksOf(section.content)[0]?.change.lines[0] ?? '')
    case 'callToAction':
      return shorten(textOf(section.heading) ?? textOf(section.linkLabel) ?? '')
    case 'cardGrid':
      return shorten(textOf(section.heading) ?? items('cards', 'title').join(' · '))
    case 'accordion':
      return shorten(textOf(section.heading) ?? items('items', 'heading').join(' · '))
    case 'embed':
      return shorten(textOf(section.title) ?? '')
    case 'image':
      return shorten(textOf(section.caption) ?? '')
    case 'columns':
      return shorten(textOf(section.heading) ?? `${sectionsOf(section.columns).length} columns`)
    case 'divider':
      return ''
    default:
      return shorten(textOf(section.heading) ?? '')
  }
}

const idOf = (section: Section): string | null =>
  section.id === undefined || section.id === null ? null : String(section.id)

/**
 * The sections that MOVED: of those in both lists, the fewest whose moving explains the new
 * order — everything outside the longest run still in its old relative order. So dragging one
 * section reads as that one moving, not as every section it passed.
 */
const movedIds = (reference: string[], order: string[]): Set<string> => {
  const common = order.filter((id) => reference.includes(id))
  const positions = common.map((id) => reference.indexOf(id))
  // Longest increasing run of old positions (patience sorting, keeping each tail as small as it
  // can be — which keeps the earlier sections and marks the one dragged).
  const tails: number[] = []
  const tailAt: number[] = []
  const previous: number[] = []
  positions.forEach((position, i) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (tails[mid]! < position) lo = mid + 1
      else hi = mid
    }
    tails[lo] = position
    tailAt[lo] = i
    previous[i] = lo > 0 ? tailAt[lo - 1]! : -1
  })
  const kept = new Set<number>()
  for (let i = tails.length > 0 ? tailAt[tails.length - 1]! : -1; i >= 0; i = previous[i]!)
    kept.add(i)
  return new Set(common.filter((_, i) => !kept.has(i)))
}

const diffSections = (before: unknown, after: unknown, where: string | null): SectionsDiff => {
  const b = sectionsOf(before)
  const a = sectionsOf(after)
  const byId = new Map(b.flatMap((s) => (idOf(s) ? [[idOf(s)!, s] as const] : [])))
  const afterIds = new Set(a.map(idOf).filter((id): id is string => id !== null))
  const moved = movedIds(
    b.map(idOf).filter((id): id is string => id !== null),
    a.map(idOf).filter((id): id is string => id !== null),
  )

  const changes: SectionChange[] = []
  let unchanged = 0
  const line = (change: SectionChange['change'], section: Section, words: BodyDiff | null = null) =>
    changes.push({
      change,
      kind: KINDS[String(section.blockType)] ?? 'Section',
      summary: summaryOf(section),
      where,
      words,
    })

  for (const section of b) {
    const id = idOf(section)
    if (id === null || !afterIds.has(id)) line('removed', section)
  }
  for (const section of a) {
    const id = idOf(section)
    const was = id === null ? undefined : byId.get(id)
    if (!was) {
      line('added', section)
      continue
    }
    if (section.blockType === 'columns' && was.blockType === 'columns') {
      // The district's columns: what changed is inside them, column by column.
      const label = textOf(section.heading)
      const inner = sectionsOf(section.columns).map((column, i) =>
        diffSections(
          sectionsOf(was.columns)[i]?.content,
          column.content,
          `In column ${i + 1}${label ? ` of “${label}”` : ''}`,
        ),
      )
      inner.forEach((d) => changes.push(...d.changes))
      if (inner.every((d) => d.changes.length === 0) && !moved.has(id!)) unchanged += 1
      else if (moved.has(id!)) line('moved', section)
      continue
    }
    if (!sameComponent(was, section)) {
      line(
        'changed',
        section,
        section.blockType === 'richText'
          ? diffBlocks(blocksOf(was.content), blocksOf(section.content))
          : null,
      )
    } else if (moved.has(id!)) line('moved', section)
    else unchanged += 1
  }
  return { changes, unchanged }
}

/** The sections a school changed, as the approval queue lists them. */
export const diffLayout = (live: unknown, proposed: unknown): SectionsDiff =>
  diffSections(live, proposed, null)

/** The same diff over an announcement's fields; the district-only ones are absent, as on pages. */
export const diffPost = (live: Doc | null, proposed: Doc): PageDiff =>
  diffFields(POST_FIELDS, live, proposed)

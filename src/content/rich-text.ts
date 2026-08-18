import type {
  RichText,
  RichTextBlock,
  RichTextInline,
  RichTextList,
  RichTextListItem,
  RichTextMark,
  RichTextText,
} from './types'

/**
 * Lexical editor state -> DD2 rich-text nodes (`02` §11, ADR-5).
 *
 * ============================================================================
 * THE MAPPING HAPPENS HERE, ONCE. Nothing downstream sees Lexical.
 * ============================================================================
 *
 * A pure function over JSON — no Payload import, no I/O — so the Phase 9 legacy
 * re-normalization (`03` §8) and the migration mappers can reuse it unchanged.
 *
 * IT MUST NEVER THROW. It runs at build and revalidate time across content authored years
 * apart: migrated Finalsite pages (`10` §5), pages written before the editor was
 * constrained, and whatever a future Payload upgrade decides an editor state looks like. A
 * node it cannot understand becomes nothing; a build that dies on one bad page takes
 * twenty-eight sites with it.
 *
 * The same instinct explains what it drops rather than rescues. An `h1` is dropped, not
 * demoted to `h2` — demoting would silently move content into a hierarchy nobody chose.
 * Strikethrough and underline are dropped while their text survives, because the words are
 * the content and the styling was never authorable (`07` §4.4).
 */

/** Lexical's inline format bitmask. Only the two marks the editor can produce are read. */
const FORMAT_BOLD = 1
const FORMAT_ITALIC = 2

type Node = Record<string, unknown>

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const childrenOf = (node: Node): unknown[] => (Array.isArray(node.children) ? node.children : [])

const marksOf = (format: unknown): RichTextMark[] => {
  const bits = typeof format === 'number' ? format : 0
  const marks: RichTextMark[] = []
  if (bits & FORMAT_BOLD) marks.push('strong')
  if (bits & FORMAT_ITALIC) marks.push('em')
  // Every other bit — strikethrough, underline, code, sub/superscript — is deliberately
  // ignored rather than mapped. See the file header.
  return marks
}

const toText = (node: Node): RichTextText | null => {
  if (typeof node.text !== 'string') return null
  return { kind: 'text', text: node.text, marks: marksOf(node.format) }
}

const toInline = (value: unknown): RichTextInline[] => {
  if (!isNode(value)) return []

  if (value.type === 'text') {
    const text = toText(value)
    return text ? [text] : []
  }

  if (value.type === 'link') {
    const fields = isNode(value.fields) ? value.fields : {}
    const href = typeof fields.url === 'string' ? fields.url.trim() : ''

    const children = childrenOf(value)
      .flatMap(toInline)
      // A link's children are text; a nested link is not something the editor can make and
      // not something HTML permits.
      .filter((child): child is RichTextText => child.kind === 'text')

    /**
     * No destination means this is not a link. An anchor without `href` is unfocusable and
     * unannounced while still looking clickable, so it is unwrapped — the words are the
     * content and they survive.
     */
    if (href === '') return children

    return [{ kind: 'link', href, newTab: fields.newTab === true, children }]
  }

  return []
}

const hasContent = (children: RichTextInline[]): boolean =>
  children.some((child) =>
    child.kind === 'text' ? child.text.trim() !== '' : child.children.length > 0,
  )

const toListItem = (value: unknown): RichTextListItem | null => {
  if (!isNode(value) || value.type !== 'listitem') return null

  const children: RichTextInline[] = []
  let nested: RichTextList | null = null

  for (const child of childrenOf(value)) {
    if (isNode(child) && child.type === 'list') {
      nested = nested ?? toList(child)
      continue
    }
    children.push(...toInline(child))
  }

  if (!hasContent(children) && nested === null) return null
  return { children, list: nested }
}

const toList = (node: Node): RichTextList | null => {
  const items = childrenOf(node)
    .map(toListItem)
    .filter((item): item is RichTextListItem => item !== null)

  if (items.length === 0) return null

  // Lexical writes `bullet`, `number`, or `check`. Checklists are denied in the editor
  // (`src/lib/editor.ts`); anything that is not explicitly numbered renders unordered.
  return { kind: 'list', ordered: node.listType === 'number', items }
}

const HEADING_LEVELS: Record<string, 2 | 3> = { h2: 2, h3: 3 }

const toBlock = (value: unknown): RichTextBlock | null => {
  if (!isNode(value)) return null

  switch (value.type) {
    case 'paragraph': {
      const children = childrenOf(value).flatMap(toInline)
      // Word pastes are full of spacer paragraphs — vertical rhythm expressed as content,
      // which the design system owns instead.
      return hasContent(children) ? { kind: 'paragraph', children } : null
    }

    case 'heading': {
      const level = typeof value.tag === 'string' ? HEADING_LEVELS[value.tag] : undefined
      // Includes `h1`: dropped, not demoted. The page title already owns level 1.
      if (!level) return null

      const children = childrenOf(value).flatMap(toInline)
      return hasContent(children) ? { kind: 'heading', level, children } : null
    }

    case 'list':
      return toList(value)

    default:
      return null
  }
}

/**
 * Maps a Lexical editor state to DD2 rich text.
 *
 * Accepts `unknown` on purpose. The caller has a value from the database whose shape is a
 * promise nobody can enforce, and a signature that claimed otherwise would push the
 * defensive checks out to every call site.
 */
export const toRichText = (state: unknown): RichText => {
  if (!isNode(state)) return []

  const root = state.root
  if (!isNode(root)) return []

  return childrenOf(root)
    .map(toBlock)
    .filter((block): block is RichTextBlock => block !== null)
}

/** True when a document has nothing worth rendering. Lets templates skip empty regions. */
export const isEmptyRichText = (richText: RichText): boolean => richText.length === 0

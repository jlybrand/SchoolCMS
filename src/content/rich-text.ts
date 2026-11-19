import { linkLabelVerdict } from '@/lib/link-label'

import { toImageAsset } from './image-asset'
import { NO_PAGE_PATHS, pathOfPage, type PagePaths } from './page-tree'
import type {
  RichText,
  RichTextAlign,
  RichTextBlock,
  RichTextInline,
  RichTextImage,
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

/**
 * The one text style, "Large text" (Jason, 2026-11-19), stored by Payload's text state as
 * `$: { size: 'large' }`. Any other state — a color, another size — is dropped; the words stay.
 */
const stateMarks = (node: Node): RichTextMark[] => {
  const state = isNode(node.$) ? node.$ : {}
  return state.size === 'large' ? ['large'] : []
}

const toText = (node: Node): RichTextText | null => {
  if (typeof node.text !== 'string') return null
  return { kind: 'text', text: node.text, marks: [...marksOf(node.format), ...stateMarks(node)] }
}

/**
 * Where a link goes. The editor's "internal link" (Jason, 2026-10-29) stores a PAGE, not an
 * address, and takes the path the page has today — so a rename or a move never breaks it, and
 * any `url` stored beside it is ignored. Only pages: a link to any other collection has no
 * public address here. A page with no current path (unpublished, staff-only, deleted, another
 * site's) gives '' and the words survive without the link.
 */
const hrefOf = (fields: Node, paths: PagePaths): string => {
  if (fields.linkType === 'internal') {
    const doc = isNode(fields.doc) ? fields.doc : {}
    return doc.relationTo === 'pages' ? (pathOfPage(doc.value, paths) ?? '') : ''
  }
  return typeof fields.url === 'string' ? fields.url.trim() : ''
}

const toInline = (value: unknown, paths: PagePaths): RichTextInline[] => {
  if (!isNode(value)) return []

  if (value.type === 'text') {
    const text = toText(value)
    return text ? [text] : []
  }

  if (value.type === 'link') {
    const fields = isNode(value.fields) ? value.fields : {}
    const href = hrefOf(fields, paths)

    const children = childrenOf(value)
      .flatMap((child) => toInline(child, paths))
      // A link's children are text; a nested link is not something the editor can make and
      // not something HTML permits.
      .filter((child): child is RichTextText => child.kind === 'text')

    /**
     * No destination means this is not a link. An anchor without `href` is unfocusable and
     * unannounced while still looking clickable, so it is unwrapped — the words are the
     * content and they survive.
     */
    if (href === '') return children

    // The link's own screen-reader words, held to 2.5.3 here whatever is stored.
    const label = linkLabelVerdict(
      typeof fields.ariaLabel === 'string' ? fields.ariaLabel : '',
      children.map((child) => child.text).join(''),
    )
    return [
      {
        kind: 'link',
        href,
        newTab: fields.newTab === true,
        ...('keep' in label ? { ariaLabel: label.keep } : {}),
        children,
      },
    ]
  }

  return []
}

const hasContent = (children: RichTextInline[]): boolean =>
  children.some((child) =>
    child.kind === 'text' ? child.text.trim() !== '' : child.children.length > 0,
  )

const toListItem = (value: unknown, paths: PagePaths): RichTextListItem | null => {
  if (!isNode(value) || value.type !== 'listitem') return null

  const children: RichTextInline[] = []
  let nested: RichTextList | null = null

  for (const child of childrenOf(value)) {
    if (isNode(child) && child.type === 'list') {
      nested = nested ?? toList(child, paths)
      continue
    }
    children.push(...toInline(child, paths))
  }

  if (!hasContent(children) && nested === null) return null
  return { children, list: nested }
}

const toList = (node: Node, paths: PagePaths): RichTextList | null => {
  const items = childrenOf(node)
    .map((item) => toListItem(item, paths))
    .filter((item): item is RichTextListItem => item !== null)

  if (items.length === 0) return null

  // Lexical writes `bullet`, `number`, or `check`. Checklists are denied in the editor
  // (`src/lib/editor.ts`); anything that is not explicitly numbered renders unordered.
  return { kind: 'list', ordered: node.listType === 'number', items }
}

const HEADING_LEVELS: Record<string, 2 | 3 | 4> = { h2: 2, h3: 3, h4: 4 }

const IMAGE_SIZES = new Set(['small', 'medium', 'full'] as const)
const IMAGE_POSITIONS = new Set(['block', 'start', 'end'] as const)

/** An image's size and place (Jason, 2026-11-19); anything else is full width, on its own line. */
const imageSettings = (fields: unknown): Pick<RichTextImage, 'size' | 'position'> => {
  const node = isNode(fields) ? fields : {}
  return {
    size: IMAGE_SIZES.has(node.size as never) ? (node.size as RichTextImage['size']) : 'full',
    position: IMAGE_POSITIONS.has(node.position as never)
      ? (node.position as RichTextImage['position'])
      : 'block',
  }
}

/**
 * Lexical's element `format` as DD2 alignment (Jason, 2026-11-19): center stays center; right or
 * end is END, so the translated page mirrors; left, start and justify are the default — justify
 * is never rendered (WCAG 1.4.8).
 */
const ALIGN: Record<string, RichTextAlign> = { center: 'center', right: 'end', end: 'end' }
const aligned = (node: Node): { align?: RichTextAlign } => {
  const align = typeof node.format === 'string' ? ALIGN[node.format] : undefined
  return align ? { align } : {}
}

/** The id of an upload node's file, populated or not. */
const uploadId = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (isNode(value) && (typeof value.id === 'number' || typeof value.id === 'string'))
    return String(value.id)
  return null
}

const toBlock = (value: unknown, paths: PagePaths): RichTextBlock | null => {
  if (!isNode(value)) return null

  switch (value.type) {
    case 'paragraph': {
      const children = childrenOf(value).flatMap((child) => toInline(child, paths))
      // Word pastes are full of spacer paragraphs — vertical rhythm expressed as content,
      // which the design system owns instead.
      return hasContent(children) ? { kind: 'paragraph', ...aligned(value), children } : null
    }

    case 'heading': {
      const level = typeof value.tag === 'string' ? HEADING_LEVELS[value.tag] : undefined
      // Includes `h1`: dropped, not demoted. The page title already owns level 1.
      if (!level) return null

      const children = childrenOf(value).flatMap((child) => toInline(child, paths))
      return hasContent(children) ? { kind: 'heading', level, ...aligned(value), children } : null
    }

    case 'list':
      return toList(value, paths)

    case 'quote': {
      const children = childrenOf(value).flatMap((child) => toInline(child, paths))
      return hasContent(children) ? { kind: 'quote', children } : null
    }

    case 'horizontalrule':
      return { kind: 'rule' }

    // Library images only: the library is where alt text is required (rule 7).
    case 'upload': {
      const id = value.relationTo === 'resources' ? uploadId(value.value) : null
      return id === null
        ? null
        : { kind: 'image', id, image: toImageAsset(value.value), ...imageSettings(value.fields) }
    }

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
 *
 * `paths` is the site's page id -> current path (`page-tree.ts`), for links to a page. Without
 * it those links keep their words and lose the link — right for a caller that only measures or
 * diffs the words.
 */
export const toRichText = (state: unknown, paths: PagePaths = NO_PAGE_PATHS): RichText => {
  if (!isNode(state)) return []

  const root = state.root
  if (!isNode(root)) return []

  return childrenOf(root)
    .map((block) => toBlock(block, paths))
    .filter((block): block is RichTextBlock => block !== null)
}

/** True when a document has nothing worth rendering. Lets templates skip empty regions. */
export const isEmptyRichText = (richText: RichText): boolean => richText.length === 0

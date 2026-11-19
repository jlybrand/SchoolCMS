/**
 * THE PASTE NORMALIZER (`07` §4.2).
 *
 * Normalization happens ON PASTE, not on render. Sanitizing at render would leave the
 * garbage in the database and re-inflict it on every future consumer, migration and export
 * (`07` §4.2) — and the Phase 9 legacy re-normalization (`03` §8) runs this same module over
 * content extracted from Finalsite, so it must be a pure function of its input.
 *
 * WHAT ARRIVES. School staff compose in Word or Google Docs and paste. What lands is
 * `<span style="mso-...">` soup, headings that are bold 14pt text rather than `<h2>`, lists
 * made of literal `•` characters and manual line breaks, and occasionally a layout table.
 * It renders identically to correct markup for a sighted reader, which is exactly why it
 * survives visual review and why this is DD2's largest source of inaccessible content today.
 *
 * WHAT LEAVES. Only the `07` §4.2 allowlist, with no attributes but `href`.
 *
 * The one judgement call this module refuses to make is heading promotion. Bold short lines
 * are REPORTED as candidates and never promoted — `07` §4.2 is explicit that auto-promotion
 * is unreliable enough to cause harm, so the UI asks one question and `promoteHeadings`
 * applies the answer.
 *
 * DOM, not a parser dependency. This runs in the browser inside Lexical's paste handler,
 * where `DOMParser` is already there. `parse` is injectable so the server-side migration
 * path can supply one without this module growing a dependency it does not need in
 * production.
 */

/**
 * `07` §4.2, plus what the editor gained on 2026-11-19 (Jason, "a more robust text editor"): the
 * Minor heading (`h4`), a quotation and a line. Typing and pasting share one vocabulary, so what
 * the editor can make a paste can keep. (Code edited in the HTML view is read back by its own
 * walker over the same vocabulary, `src/lib/html-source.ts`.)
 * Anything else is unwrapped to its text content.
 */
export const ALLOWED_ELEMENTS = [
  'p',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'a',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
] as const satisfies readonly string[]

export type PasteRejectionKind = 'table' | 'image'

export type PasteRejection = {
  kind: PasteRejectionKind
  count: number
  /** Shown to the author verbatim. Plain language, and it must say what to do instead. */
  message: string
}

export type HeadingCandidate = {
  /** Index into the top-level blocks of `NormalizedPaste.html`. */
  blockIndex: number
  text: string
}

export type NormalizedPaste = {
  html: string
  rejections: PasteRejection[]
  headingCandidates: HeadingCandidate[]
}

export type HtmlParser = (html: string) => Document

const defaultParse: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html')

/**
 * Rejection copy (`07` §4.2 rows 6–7).
 *
 * Written to the "no training, no documentation" bar: name what happened, say why in one
 * clause a non-specialist can act on, and give the alternative. No jargon — an author who
 * reads "semantic markup" learns nothing they can do something about.
 */
export const REJECTION_MESSAGES: Record<PasteRejectionKind, string> = {
  table:
    'We removed a table. Tables are hard to read on a phone and hard to follow with a screen reader. Put the information in a list instead, or ask the district team if this really needs to be a table.',
  image:
    'We removed an image. Add images with the Insert an image button instead — it asks you to describe the picture for people who cannot see it, and a pasted image skips that step.',
}

/** Elements whose content is markup or styling, never author content. */
const DISCARDED_TAGS = new Set([
  'style',
  'script',
  'link',
  'meta',
  'title',
  'head',
  'noscript',
  'template',
  'col',
  'colgroup',
  /**
   * Word's paragraph-mark placeholder. It holds a stray `&nbsp;` at the end of most
   * paragraphs and never holds author content, so it is dropped rather than unwrapped —
   * unwrapping it would leave a trailing space on nearly every block.
   */
  'o:p',
])

/**
 * Tags that start a new block. `div` is here so a Google Docs paragraph wrapper does not run
 * two paragraphs together, and the table parts are here because their text is salvaged as
 * paragraphs once the table itself is rejected.
 */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

/**
 * Whether an element has a block-level descendant.
 *
 * Walked by hand rather than with `querySelector(BLOCK_TAGS.join(','))`, which is wrong here:
 * a CSS type selector of `p` matches Word's `<o:p>` under jsdom's selector engine, so every
 * Word span ending in `<o:p>` looked like a block container. That split each list paragraph
 * in two and orphaned its bullet, turning the whole agenda into loose paragraphs. Matching on
 * `localName` exactly also removes the dependence on selector-engine behaviour differing
 * between jsdom and the browser this actually runs in.
 */
const containsBlock = (element: Element): boolean => {
  for (const child of element.children) {
    if (BLOCK_TAGS.has(child.localName)) return true
    if (containsBlock(child)) return true
  }
  return false
}

/**
 * Line-leading list markers (`07` §4.2 row 3).
 *
 * `·` (U+00B7) is here because it is what Word actually emits for a Symbol-font bullet —
 * `•` is what the spec writes and what a human types. The em dash is deliberately absent:
 * a line opening "— a closing thought" is prose, not an item.
 */
const LIST_MARKER = /^(?:([•·▪◦*\-–])|(\d{1,3})[.)]|([a-zA-Z])[.)])[ \t]+/
const BARE_MARKER = /^(?:[•·▪◦*\-–]|\d{1,3}[.)]|[a-zA-Z][.)])$/

type ListStyle = 'bullet' | 'decimal' | 'alpha'

type Format = { strong: boolean; em: boolean; href?: string }

type Inline = { text: string; strong: boolean; em: boolean; href?: string }

/** A `<br>` inside a run of inline content. Becomes a line boundary, never an element. */
type LineBreak = { br: true }

type Piece = Inline | LineBreak

const isBreak = (piece: Piece): piece is LineBreak => 'br' in piece

/** A block of words: a paragraph, one of the three headings, or a quotation. */
type TextTag = 'p' | 'h2' | 'h3' | 'h4' | 'blockquote'

type Unit =
  | { type: TextTag; inlines: Inline[] }
  | { type: 'item'; style: ListStyle; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'rule' }

/**
 * `kind` is carried alongside `tag` as an explicit discriminant. Narrowing on `tag` alone
 * does not work here: both variants admit several tag literals, so excluding `ul`/`ol` still
 * leaves the compiler unable to rule the list variant out.
 */
type Block =
  | { kind: 'text'; tag: TextTag; inlines: Inline[] }
  | { kind: 'list'; tag: 'ul' | 'ol'; items: Inline[][] }
  | { kind: 'rule' }

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Quiet normalization (`07` §4.2 row 4).
 *
 * Curly quotes become straight so that a string pasted from Word and the same string typed
 * in the editor are the same string — otherwise search, translation-string hashing (`08`
 * §4) and diffing all treat them as different content. En and em dashes are left alone:
 * they carry meaning, and no downstream system is confused by them.
 */
const normalizeChars = (text: string): string =>
  text
    .replace(/ /g, ' ')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/​/g, '')

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

/**
 * Collapses whitespace ACROSS inline boundaries, not within each one.
 *
 * Word splits a single sentence over several spans and puts the space at a boundary, so
 * per-inline trimming would either weld words together or leave doubled spaces behind.
 */
const collapseAcross = (inlines: Inline[]): Inline[] => {
  let previousWasSpace = true
  const out: Inline[] = []

  for (const inline of inlines) {
    let text = ''
    for (const ch of inline.text) {
      if (isSpace(ch)) {
        if (!previousWasSpace) {
          text += ' '
          previousWasSpace = true
        }
        continue
      }
      text += ch
      previousWasSpace = false
    }
    if (text !== '') out.push({ ...inline, text })
  }

  const last = out[out.length - 1]
  if (last && last.text.endsWith(' ')) last.text = last.text.slice(0, -1)

  return out.filter((inline) => inline.text !== '')
}

/** Merges neighbours that would otherwise serialize as `<strong>A</strong><strong>B</strong>`. */
const mergeAdjacent = (inlines: Inline[]): Inline[] => {
  const out: Inline[] = []
  for (const inline of inlines) {
    const previous = out[out.length - 1]
    if (
      previous &&
      previous.strong === inline.strong &&
      previous.em === inline.em &&
      previous.href === inline.href
    ) {
      previous.text += inline.text
      continue
    }
    out.push({ ...inline })
  }
  return out
}

/** Drops `count` characters from the front of a line, across inline boundaries. */
const stripLeading = (inlines: Inline[], count: number): Inline[] => {
  let remaining = count
  const out: Inline[] = []

  for (const inline of inlines) {
    if (remaining <= 0) {
      out.push(inline)
      continue
    }
    if (inline.text.length <= remaining) {
      remaining -= inline.text.length
      continue
    }
    out.push({ ...inline, text: inline.text.slice(remaining) })
    remaining = 0
  }

  return out
}

const textOf = (inlines: Inline[]): string => inlines.map((inline) => inline.text).join('')

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const styleValue = (element: Element, property: string): string | null => {
  const style = element.getAttribute('style')
  if (!style) return null
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(style)
  return match?.[1]?.trim().toLowerCase() ?? null
}

/**
 * Google Docs never emits `<b>` or `<strong>` — bold is `font-weight:700` on a span, and the
 * whole payload is wrapped in `<b style="font-weight:normal">`. So the style declaration has
 * to be read before it is stripped, and it has to WIN over the tag, or every Google Docs
 * paste arrives entirely bold.
 */
const isBold = (element: Element, inherited: boolean): boolean => {
  const weight = styleValue(element, 'font-weight')
  if (weight) return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600
  const tag = element.localName
  if (tag === 'b' || tag === 'strong') return true
  return inherited
}

const isItalic = (element: Element, inherited: boolean): boolean => {
  const style = styleValue(element, 'font-style')
  if (style) return style === 'italic' || style === 'oblique'
  const tag = element.localName
  if (tag === 'i' || tag === 'em') return true
  return inherited
}

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Keeps a link only if its destination is one an author could have meant.
 *
 * Also unwraps the Google Docs redirect. Storing `google.com/url?q=…` would make every
 * pasted link depend on Google staying up and would defeat the link checker, so the real
 * destination is recovered here rather than left for someone to notice later.
 */
export const sanitizeHref = (raw: string | null): string | undefined => {
  const href = raw?.trim()
  if (!href) return undefined

  // Relative and fragment links have no scheme to check.
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) return href

  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  if (!SAFE_SCHEMES.has(url.protocol)) return undefined

  if (url.hostname === 'www.google.com' && url.pathname === '/url') {
    const target = url.searchParams.get('q')
    if (target) return sanitizeHref(target)
  }

  return href
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

/** h1 is the page title's, so it becomes h2; below h4 the editor has no name, so h5–h6 are h4. */
const headingTagFor = (tag: string): 'h2' | 'h3' | 'h4' =>
  tag === 'h1' || tag === 'h2' ? 'h2' : tag === 'h3' ? 'h3' : 'h4'

/** Flattens an element to inline pieces, ignoring any block structure inside it. */
const piecesOf = (node: Node, format: Format): Piece[] => {
  const out: Piece[] = []

  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3 /* text */) {
      const text = normalizeChars(child.nodeValue ?? '')
      if (text !== '') out.push({ text, ...format })
      continue
    }

    if (child.nodeType !== 1 /* element */) continue

    const element = child as Element
    const tag = element.localName

    if (DISCARDED_TAGS.has(tag)) continue
    if (tag === 'br') {
      out.push({ br: true })
      continue
    }

    const next: Format = {
      strong: isBold(element, format.strong),
      em: isItalic(element, format.em),
    }

    const href = tag === 'a' ? sanitizeHref(element.getAttribute('href')) : format.href
    if (href !== undefined) next.href = href

    out.push(...piecesOf(element, next))
  }

  return out
}

/** Splits a piece run on `<br>` and cleans each resulting line. */
const linesOf = (pieces: Piece[]): Inline[][] => {
  const lines: Inline[][] = []
  let current: Inline[] = []

  for (const piece of pieces) {
    if (isBreak(piece)) {
      lines.push(current)
      current = []
      continue
    }
    current.push(piece)
  }
  lines.push(current)

  return lines.map((line) => mergeAdjacent(collapseAcross(line))).filter((line) => line.length > 0)
}

const listStyleOf = (match: RegExpExecArray): ListStyle => {
  if (match[1] !== undefined) return 'bullet'
  if (match[2] !== undefined) return 'decimal'
  return 'alpha'
}

/**
 * Turns one source block's lines into units, reconstructing any that open with a list marker.
 *
 * `07` §4.2 calls this the highest-value transform, because agendas and supply lists are
 * mostly lists and a literal `•` carries no structure at all.
 */
const unitsFromLines = (lines: Inline[][], tag: TextTag): Unit[] => {
  const out: Unit[] = []

  for (const line of lines) {
    const text = textOf(line)
    if (text === '') continue

    // A marker with nothing after it is leftover spacing, not an item.
    if (BARE_MARKER.test(text)) continue

    // A pasted heading is already structural; a leading "1." in one is part of the title.
    const match = tag === 'p' ? LIST_MARKER.exec(text) : null
    if (match) {
      const inlines = mergeAdjacent(stripLeading(line, match[0].length))
      if (inlines.length > 0) out.push({ type: 'item', style: listStyleOf(match), inlines })
      continue
    }

    out.push({ type: tag, inlines: line })
  }

  return out
}

const listUnitFrom = (element: Element, format: Format): Unit => {
  const items: Inline[][] = []

  for (const child of [...element.children]) {
    if (child.localName !== 'li') continue
    // A `<br>` inside a list item is intra-item wrapping, not a new item.
    const pieces = piecesOf(child, format).filter((piece): piece is Inline => !isBreak(piece))
    const inlines = mergeAdjacent(collapseAcross(pieces))
    if (inlines.length > 0) items.push(inlines)
  }

  return { type: 'list', ordered: element.localName === 'ol', items }
}

/**
 * Walks the tree into a flat unit stream.
 *
 * `format` is threaded through rather than recomputed, because Google Docs wraps whole
 * documents in a formatting element and Word nests spans several deep.
 *
 * `quoted` is true inside a `<blockquote>`: its words become quotes — one per paragraph, since
 * the editor's quote holds a line of text, not paragraphs — while a list or heading inside it
 * stays a list or heading.
 */
const walk = (node: Node, format: Format, out: Unit[], quoted = false): void => {
  let pending: Piece[] = []

  const flush = (tag: TextTag = quoted ? 'blockquote' : 'p') => {
    if (pending.length === 0) return
    out.push(...unitsFromLines(linesOf(pending), tag))
    pending = []
  }

  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3 /* text */) {
      const text = normalizeChars(child.nodeValue ?? '')
      if (text !== '') pending.push({ text, ...format })
      continue
    }

    if (child.nodeType !== 1 /* element */) continue

    const element = child as Element
    const tag = element.localName

    if (DISCARDED_TAGS.has(tag)) continue

    if (tag === 'br') {
      pending.push({ br: true })
      continue
    }

    if (tag === 'hr') {
      flush()
      out.push({ type: 'rule' })
      continue
    }

    const next: Format = {
      strong: isBold(element, format.strong),
      em: isItalic(element, format.em),
    }
    const href = tag === 'a' ? sanitizeHref(element.getAttribute('href')) : format.href
    if (href !== undefined) next.href = href

    if (tag === 'ul' || tag === 'ol') {
      flush()
      const list = listUnitFrom(element, next)
      if (list.type === 'list' && list.items.length > 0) out.push(list)
      continue
    }

    if (/^h[1-6]$/.test(tag)) {
      flush()
      out.push(...unitsFromLines(linesOf(piecesOf(element, next)), headingTagFor(tag)))
      continue
    }

    /**
     * A formatting element that CONTAINS blocks — `<b style="font-weight:normal">` around a
     * whole Google Docs paste — is transparent: recurse so the blocks survive, carrying the
     * format inward so the wrapper's own declaration still applies.
     */
    if (BLOCK_TAGS.has(tag) || containsBlock(element)) {
      flush()
      walk(element, next, out, quoted || tag === 'blockquote')
      continue
    }

    pending.push(...piecesOf(element, next))
  }

  flush()
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Merges consecutive reconstructed items of the same marker style into one list. */
const toBlocks = (units: Unit[]): Block[] => {
  const blocks: Block[] = []
  let run: { style: ListStyle; items: Inline[][] } | null = null

  const closeRun = () => {
    if (!run) return
    blocks.push({ kind: 'list', tag: run.style === 'bullet' ? 'ul' : 'ol', items: run.items })
    run = null
  }

  for (const unit of units) {
    if (unit.type === 'item') {
      // A change of marker style is a new list: a numbered agenda followed by lettered
      // sub-points is two lists, and flattening them loses the author's grouping.
      if (run && run.style !== unit.style) closeRun()
      run ??= { style: unit.style, items: [] }
      run.items.push(unit.inlines)
      continue
    }

    closeRun()

    if (unit.type === 'rule') {
      // Two lines with nothing between them are one line — the gap held no content.
      if (blocks[blocks.length - 1]?.kind !== 'rule') blocks.push({ kind: 'rule' })
      continue
    }

    if (unit.type === 'list') {
      blocks.push({ kind: 'list', tag: unit.ordered ? 'ol' : 'ul', items: unit.items })
      continue
    }

    blocks.push({ kind: 'text', tag: unit.type, inlines: unit.inlines })
  }

  closeRun()
  return blocks
}

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, '&quot;')

const serializeInlines = (inlines: Inline[]): string =>
  inlines
    .map((inline) => {
      let out = escapeText(inline.text)
      if (inline.em) out = `<em>${out}</em>`
      if (inline.strong) out = `<strong>${out}</strong>`
      if (inline.href) out = `<a href="${escapeAttribute(inline.href)}">${out}</a>`
      return out
    })
    .join('')

const serializeBlock = (block: Block): string => {
  if (block.kind === 'rule') return '<hr>'
  if (block.kind === 'list') {
    const items = block.items.map((item) => `<li>${serializeInlines(item)}</li>`).join('')
    return `<${block.tag}>${items}</${block.tag}>`
  }
  return `<${block.tag}>${serializeInlines(block.inlines)}</${block.tag}>`
}

/** Longest a bold line can be and still plausibly be a heading rather than a bold sentence. */
const MAX_HEADING_CANDIDATE_LENGTH = 80

/**
 * Bold short lines that look like headings (`07` §4.2 row 5).
 *
 * OFFERED, NEVER ASSUMED. This function only decides what to ask about; nothing here
 * changes the markup. The prompt requires no understanding of what a heading is — only a
 * yes — which is why it is a question rather than a heuristic that acts on its own.
 */
const headingCandidatesFor = (blocks: Block[]): HeadingCandidate[] => {
  const candidates: HeadingCandidate[] = []

  blocks.forEach((block, blockIndex) => {
    // A pasted h2/h3 is already a heading, and a bold list item is an item.
    if (block.kind !== 'text' || block.tag !== 'p') return
    if (block.inlines.length === 0) return
    if (!block.inlines.every((inline) => inline.strong)) return

    const text = textOf(block.inlines).trim()
    if (text.length === 0 || text.length > MAX_HEADING_CANDIDATE_LENGTH) return
    // Terminal punctuation reads as a sentence the author emphasised, not as a title.
    if (/[.!?]$/.test(text)) return

    candidates.push({ blockIndex, text })
  })

  return candidates
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes a clipboard HTML payload.
 *
 * Rejected content is removed and REPORTED rather than failing the whole paste: an agenda
 * pasted with one decorative image must not cost the author the agenda (`04` §2.1 — the
 * school manager who attended no training completes their task unaided).
 */
export const normalizePastedHtml = (
  html: string,
  parse: HtmlParser = defaultParse,
): NormalizedPaste => {
  const document = parse(html)
  const body = document.body
  if (!body) return { html: '', rejections: [], headingCandidates: [] }

  // Word emits downlevel conditional comments (`<![if !supportLists]>`) that parse as
  // comment nodes and would otherwise survive into the output.
  for (const node of [...body.childNodes]) removeComments(node)
  removeComments(body)

  const rejections: PasteRejection[] = []
  for (const [kind, selector] of [
    ['table', 'table'],
    ['image', 'img,picture,svg'],
  ] as const) {
    const found = [...body.querySelectorAll(selector)]
    if (found.length === 0) continue
    rejections.push({ kind, count: found.length, message: REJECTION_MESSAGES[kind] })
    for (const element of found) element.remove()
  }

  const units: Unit[] = []
  walk(body, { strong: false, em: false }, units)

  const blocks = toBlocks(units)

  return {
    html: blocks.map(serializeBlock).join(''),
    rejections,
    headingCandidates: headingCandidatesFor(blocks),
  }
}

const removeComments = (node: Node): void => {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8 /* comment */) {
      child.parentNode?.removeChild(child)
      continue
    }
    if (child.nodeType === 1 /* element */) removeComments(child)
  }
}

/**
 * Applies the author's answer to the heading prompt.
 *
 * Separate from `normalizePastedHtml` because the answer arrives later — the normalizer runs
 * on paste and this runs when the author says yes. `blockIndexes` are the `blockIndex`
 * values from `NormalizedPaste.headingCandidates`.
 */
export const promoteHeadings = (
  html: string,
  blockIndexes: readonly number[],
  level: 'h2' | 'h3' = 'h2',
  parse: HtmlParser = defaultParse,
): string => {
  if (blockIndexes.length === 0) return html

  const document = parse(html)
  const body = document.body
  if (!body) return html

  const targets = new Set(blockIndexes)

  return [...body.children]
    .map((block, index) => {
      if (!targets.has(index)) return block.outerHTML

      // The bold was how the author expressed "this is a heading". Once the element says so,
      // repeating it as <strong> is redundant emphasis a screen reader announces twice.
      const only = block.children.length === 1 ? block.children[0] : null
      const inner =
        only?.localName === 'strong' && only.textContent === block.textContent
          ? only.innerHTML
          : block.innerHTML

      return `<${level}>${inner}</${level}>`
    })
    .join('')
}

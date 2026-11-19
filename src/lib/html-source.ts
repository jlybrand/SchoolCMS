import { linkLabelVerdict } from './link-label'
import { permalinkPath, parsePermalinkId } from './permalink'
import { REJECTION_MESSAGES, sanitizeHref, type HtmlParser } from './paste-normalizer'

/**
 * THE TEXT AS HTML (Jason, 2026-11-19): "select <> and the contents of the text editor are shown
 * in HTML5" — and put back when edited. Before that the same day, "inserting WCAG 2.1 AA
 * compliant HTML … that is checked before hand".
 *
 * ============================================================================
 * A ROUND TRIP OVER ONE VOCABULARY. What the editor can make is written as
 * clean HTML5 and read back exactly; anything else in the code is NAMED and
 * taken out before the text changes. The HTML is never stored as written.
 * ============================================================================
 *
 *   lexicalToHtml — editor state → HTML5, one block a line, lists indented. Alignment is
 *                   `style="text-align: center|end"`, Large text `<span class="large-text">`, a
 *                   page link its permalink (`/dd2/pages/<id>`, so it never breaks), a library
 *                   image a real `<img src alt>` with `data-size`/`data-place`.
 *   htmlToLexical — that HTML, as the author left it, → editor nodes. Its own strict walker, not
 *                   the paste normalizer: the normalizer repairs Word (rebuilds "1." lists,
 *                   straightens quotes, promotes nothing), and an author's own code must come back
 *                   as written. The ALLOWLIST is the same (`07` §4.2, §4.4).
 *
 * Images: only files this text already holds (`SourceContext.images`, filled by the dialog from
 * the library) come back — a new image is added with "Insert an image", where alt text is
 * required (rule 7). The library's alt text is the image's; an edited `alt` is not stored.
 *
 * Pure: DOM only (the browser's, or an injected parser), no Payload import.
 */

// ---------------------------------------------------------------------------
// Context and results
// ---------------------------------------------------------------------------

export type SourceImage = { src: string; alt: string }

export type SourceContext = {
  /** Library files by id — every image the text holds. Its `src` is how the HTML names it. */
  images: ReadonlyMap<string | number, SourceImage>
  /** An id for each new link and image node (Payload gives them ObjectID-like ids). */
  newId?: () => string
}

export type HtmlSourceRemovalKind =
  | 'embed'
  | 'script'
  | 'form'
  | 'link'
  | 'label'
  | 'table'
  | 'image'
  | 'heading'
  | 'styling'
  | 'attributes'

export type HtmlSourceRemoval = {
  kind: HtmlSourceRemovalKind
  count: number
  /** Shown to the author verbatim: what was removed, why, and what to do instead. */
  message: string
}

type Json = Record<string, unknown>

export type HtmlSourceResult = {
  /** The text's new top-level nodes, as Lexical serializes them. */
  children: Json[]
  /** In `ORDER`, each kind at most once. */
  removals: HtmlSourceRemoval[]
  /** True when nothing in the code could be kept. */
  empty: boolean
}

/** The order the dialog lists removals in: the most surprising loss first. */
const ORDER: readonly HtmlSourceRemovalKind[] = [
  'embed',
  'script',
  'form',
  'link',
  'label',
  'table',
  'image',
  'heading',
  'styling',
  'attributes',
]

/** Written to the no-training bar, like the normalizer's (`07` §4.2). */
const MESSAGES: Record<HtmlSourceRemovalKind, string> = {
  embed:
    'We removed embedded content — a form, map, video or similar. Text cannot hold it. Put a video in a Video section; for anything else, ask the district team.',
  script:
    'We removed code that runs in the browser — a script, or an action on a click or a link. The site does not allow it: it can break pages and put visitors at risk.',
  form: 'We removed form fields. To collect answers, make the form in Microsoft Forms and ask the district team to add it to the page.',
  link: 'We removed links whose address is not a web, email or phone address. Their words stay — add the link again with the Link button.',
  label:
    'We removed a link’s screen-reader words that leave out the link’s own words. People using voice control say the words they see, so the label must include them — “Read more about the bond election” for a link that says “Read more”.',
  table: REJECTION_MESSAGES.table,
  image: REJECTION_MESSAGES.image,
  heading: 'A main heading became a Heading. The page title is the only main heading a page has.',
  attributes:
    'We removed attributes the text cannot keep — ARIA (aria-…, role), lang, title, id and the like. Headings, lists and links already tell screen readers what they are, and a link’s screen-reader words are kept only when they add to its own. The page’s language is set for the whole page.',
  styling:
    'We removed styling — colors, fonts, sizes and classes. The site’s design decides how text looks, so it stays readable for everyone. Centered or right-aligned text, and Large text, stay.',
}

// ---------------------------------------------------------------------------
// Editor state → HTML
// ---------------------------------------------------------------------------

const FORMAT_BOLD = 1
const FORMAT_ITALIC = 2
const LARGE_CLASS = 'large-text'

const SIZES = ['small', 'medium', 'full'] as const
const PLACES = ['block', 'start', 'end'] as const

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const kids = (node: Json): Json[] =>
  Array.isArray(node.children) ? node.children.filter(isJson) : []

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttribute = (value: string): string => escapeText(value).replace(/"/g, '&quot;')

/** Center and end only — `07` §4.4's exception; left, start and justify are the default. */
const alignOf = (format: unknown): 'center' | 'end' | null =>
  format === 'center' ? 'center' : format === 'right' || format === 'end' ? 'end' : null

const alignAttribute = (format: unknown): string => {
  const align = alignOf(format)
  return align ? ` style="text-align: ${align}"` : ''
}

const linkHref = (fields: Json): string => {
  if (fields.linkType === 'internal') {
    const doc = isJson(fields.doc) ? fields.doc : {}
    const id = doc.value
    return doc.relationTo === 'pages' && (typeof id === 'number' || typeof id === 'string')
      ? permalinkPath(id)
      : ''
  }
  return typeof fields.url === 'string' ? fields.url : ''
}

const inlineHtml = (nodes: Json[]): string =>
  nodes
    .map((node) => {
      if (node.type === 'linebreak') return '<br>'
      if (node.type === 'text' && typeof node.text === 'string') {
        let out = escapeText(node.text)
        const bits = typeof node.format === 'number' ? node.format : 0
        if (bits & FORMAT_ITALIC) out = `<em>${out}</em>`
        if (bits & FORMAT_BOLD) out = `<strong>${out}</strong>`
        if (isJson(node.$) && node.$.size === 'large')
          out = `<span class="${LARGE_CLASS}">${out}</span>`
        return out
      }
      if (node.type === 'link') {
        const fields = isJson(node.fields) ? node.fields : {}
        const href = linkHref(fields)
        const inner = inlineHtml(kids(node))
        if (href === '') return inner
        const tab = fields.newTab === true ? ' target="_blank" rel="noopener"' : ''
        const label =
          typeof fields.ariaLabel === 'string' && fields.ariaLabel.trim() !== ''
            ? ` aria-label="${escapeAttribute(fields.ariaLabel)}"`
            : ''
        return `<a href="${escapeAttribute(href)}"${label}${tab}>${inner}</a>`
      }
      return ''
    })
    .join('')

const listHtml = (list: Json, depth: number): string[] => {
  const pad = '  '.repeat(depth)
  const tag = list.listType === 'number' ? 'ol' : 'ul'
  const items: string[][] = []

  for (const item of kids(list)) {
    if (item.type !== 'listitem') continue
    const nested = kids(item).filter((child) => child.type === 'list')
    const words = inlineHtml(kids(item).filter((child) => child.type !== 'list'))

    // Lexical keeps a nested list in an item of its own; HTML puts it inside the item before.
    if (words === '' && nested.length > 0 && items.length > 0) {
      const previous = items[items.length - 1]!
      for (const sub of nested) previous.push(...listHtml(sub, depth + 2))
      continue
    }

    const lines = [`${pad}  <li>${words}`]
    for (const sub of nested) lines.push(...listHtml(sub, depth + 2))
    items.push(lines)
  }

  const out = [`${pad}<${tag}>`]
  for (const lines of items) {
    if (lines.length === 1) out.push(`${lines[0]}</li>`)
    else out.push(...lines, `${pad}  </li>`)
  }
  out.push(`${pad}</${tag}>`)
  return out
}

const blockHtml = (node: Json, ctx: SourceContext): string[] => {
  switch (node.type) {
    case 'paragraph': {
      const inner = inlineHtml(kids(node))
      return inner === '' ? [] : [`<p${alignAttribute(node.format)}>${inner}</p>`]
    }
    case 'heading': {
      const tag = node.tag === 'h3' || node.tag === 'h4' ? node.tag : 'h2'
      return [`<${tag}${alignAttribute(node.format)}>${inlineHtml(kids(node))}</${tag}>`]
    }
    case 'quote':
      return [`<blockquote>${inlineHtml(kids(node))}</blockquote>`]
    case 'list':
      return listHtml(node, 0)
    case 'horizontalrule':
      return ['<hr>']
    case 'upload': {
      const id = isJson(node.value) ? node.value.id : node.value
      const image =
        node.relationTo === 'resources' && (typeof id === 'number' || typeof id === 'string')
          ? ctx.images.get(id)
          : undefined
      if (!image) return []
      const fields = isJson(node.fields) ? node.fields : {}
      const size =
        SIZES.includes(fields.size as never) && fields.size !== 'full' ? fields.size : null
      const place =
        PLACES.includes(fields.position as never) && fields.position !== 'block'
          ? fields.position
          : null
      return [
        `<img src="${escapeAttribute(image.src)}" alt="${escapeAttribute(image.alt)}"` +
          (size ? ` data-size="${String(size)}"` : '') +
          (place ? ` data-place="${String(place)}"` : '') +
          '>',
      ]
    }
    default:
      return []
  }
}

export const lexicalToHtml = (root: unknown, ctx: SourceContext): string =>
  isJson(root)
    ? kids(root)
        .flatMap((node) => blockHtml(node, ctx))
        .join('\n')
    : ''

// ---------------------------------------------------------------------------
// HTML → editor state
// ---------------------------------------------------------------------------

const EMBED_SELECTOR = 'iframe,frame,frameset,object,embed,applet,video,audio,canvas'
const FORM_SELECTOR = 'form,input,button,select,textarea'
/** Schemes that run code rather than go somewhere. */
const SCRIPT_HREF = /^\s*(?:javascript|vbscript|data):/i

/** Content that is never words. Dropped with its contents, uncounted unless named below. */
const SILENT_TAGS = new Set(['head', 'title', 'meta', 'link', 'noscript', 'template', 'colgroup'])
const TABLE_PARTS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'])
const CONTAINERS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'figure',
  'figcaption',
  'address',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'pre',
  'center',
  'body',
  'html',
  ...TABLE_PARTS,
])
const BLOCKS = new Set([
  ...CONTAINERS,
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'img',
])
/** Appearance only — the words inside are kept, the look is named and dropped. */
const STYLING_TAGS = new Set(['font', 'u', 's', 'strike', 'mark', 'big', 'small', 'tt', 'center'])

/**
 * Attributes the walker understands, or names under another heading. Anything else on an element
 * — ARIA, `role`, `lang`, `title`, `id`, `tabindex`, `data-*` — has nowhere to live in the editor,
 * so it is dropped and NAMED ('attributes'), never silently (Jason, 2026-11-19: "attributes get
 * stripped from pasted in HTML, i.e. aria attributes").
 */
const UNDERSTOOD_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  /** `aria-label` is read by the link itself, held to WCAG 2.5.3 (`linkLabelVerdict`). */
  a: ['href', 'target', 'rel', 'aria-label'],
  img: ['src', 'alt', 'data-size', 'data-place'],
}
/** Named as styling ('styling'), not as an attribute. */
const STYLING_ATTRIBUTES = new Set([
  'style',
  'class',
  'color',
  'bgcolor',
  'align',
  'face',
  'size',
  'width',
  'height',
])

const hasOtherAttributes = (element: Element): boolean =>
  [...element.attributes].some((attribute) => {
    const name = attribute.name.toLowerCase()
    if (name.startsWith('on') || STYLING_ATTRIBUTES.has(name)) return false
    return !(UNDERSTOOD_ATTRIBUTES[element.localName] ?? []).includes(name)
  })

const defaultParse: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html')
const randomId = (): string =>
  Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('')

type Mark = { bold: boolean; italic: boolean; large: boolean; link: Json | null }

type Walker = {
  ctx: SourceContext
  imageBySrc: Map<string, string | number>
  count: (kind: HtmlSourceRemovalKind, n?: number) => void
  id: () => string
}

/** One `text-align`, center or end, is allowed; any other declaration is styling. */
const readStyle = (element: Element, walker: Walker, alignable: boolean): string => {
  const style = element.getAttribute('style')
  let align = ''
  let other = false
  if (style) {
    for (const declaration of style.split(';')) {
      const [property, ...rest] = declaration.split(':')
      const name = property?.trim().toLowerCase() ?? ''
      const value = rest.join(':').trim().toLowerCase()
      if (name === '') continue
      if (alignable && name === 'text-align') {
        align = value === 'center' ? 'center' : value === 'right' || value === 'end' ? 'end' : ''
        if (align === '' && value !== 'left' && value !== 'start') other = true
        continue
      }
      other = true
    }
  }
  const classes = (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
  const largeSpan =
    element.localName === 'span' && classes.length === 1 && classes[0] === LARGE_CLASS
  if (classes.length > 0 && !largeSpan) other = true
  for (const attribute of ['color', 'bgcolor', 'align', 'face', 'size', 'width', 'height']) {
    if (element.localName !== 'img' && element.hasAttribute(attribute)) other = true
  }
  if (STYLING_TAGS.has(element.localName)) other = true
  if (other) walker.count('styling')
  return align
}

const textNode = (text: string, mark: Mark): Json => ({
  type: 'text',
  version: 1,
  text,
  format: (mark.bold ? FORMAT_BOLD : 0) | (mark.italic ? FORMAT_ITALIC : 0),
  detail: 0,
  mode: 'normal',
  style: '',
  ...(mark.large ? { $: { size: 'large' } } : {}),
})

/** Inline content of an element, as Lexical nodes, plus any images found inside it. */
const inlineOf = (
  node: Node,
  mark: Mark,
  walker: Walker,
  out: { inline: Json[]; images: Json[] },
): void => {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      const text = (child.nodeValue ?? '').replace(/[ \t\n\r\f]+/g, ' ')
      if (text !== '') out.inline.push(textNode(text, mark))
      continue
    }
    if (child.nodeType !== 1) continue
    const element = child as Element
    const tag = element.localName

    if (SILENT_TAGS.has(tag) || tag === 'script' || tag === 'style') continue
    if (tag === 'br') {
      out.inline.push({ type: 'linebreak', version: 1 })
      continue
    }
    if (tag === 'img' || tag === 'picture' || tag === 'svg') {
      const image = imageNode(element, walker)
      if (image) out.images.push(image)
      continue
    }

    readStyle(element, walker, false)
    const next: Mark = {
      ...mark,
      bold: mark.bold || tag === 'strong' || tag === 'b',
      italic: mark.italic || tag === 'em' || tag === 'i',
      large:
        mark.large ||
        (tag === 'span' && (element.getAttribute('class') ?? '').trim() === LARGE_CLASS),
    }

    if (tag === 'a') {
      const link = linkNode(element, walker)
      if (link) {
        const inner = { inline: [] as Json[], images: out.images }
        inlineOf(element, { ...next, link }, walker, inner)
        if (inner.inline.length === 0) continue
        const words = inner.inline
          .map((node) => (typeof node.text === 'string' ? node.text : ''))
          .join('')
        const label = linkLabelVerdict(element.getAttribute('aria-label'), words)
        if ('keep' in label) link.fields = { ...(link.fields as Json), ariaLabel: label.keep }
        else if (label.drop === 'repeats') walker.count('attributes')
        else if (label.drop === 'missing-words') walker.count('label')
        out.inline.push({ ...link, children: inner.inline })
        continue
      }
    }
    inlineOf(element, next, walker, out)
  }
}

const linkNode = (element: Element, walker: Walker): Json | null => {
  const raw = element.getAttribute('href')
  if (raw === null || raw.trim() === '') return null
  if (SCRIPT_HREF.test(raw)) {
    walker.count('script')
    return null
  }
  const href = sanitizeHref(raw)
  if (href === undefined) {
    walker.count('link')
    return null
  }
  const newTab = element.getAttribute('target') === '_blank'
  const permalink = /^\/dd2\/pages\/([^/?#]+)$/.exec(href)
  const pageId = permalink ? parsePermalinkId(permalink[1]) : null
  const fields =
    pageId !== null
      ? { linkType: 'internal', doc: { relationTo: 'pages', value: Number(pageId) }, newTab }
      : { linkType: 'custom', url: href, newTab }
  return {
    version: 3,
    format: '',
    indent: 0,
    direction: null,
    type: 'link',
    id: walker.id(),
    fields,
  }
}

const imageNode = (element: Element, walker: Walker): Json | null => {
  const id =
    element.localName === 'img'
      ? walker.imageBySrc.get(element.getAttribute('src') ?? '')
      : undefined
  if (id === undefined) {
    walker.count('image')
    return null
  }
  const size = element.getAttribute('data-size')
  const place = element.getAttribute('data-place')
  return {
    type: 'upload',
    version: 3,
    id: walker.id(),
    relationTo: 'resources',
    value: id,
    fields: {
      size: SIZES.includes(size as never) ? size : 'full',
      position: PLACES.includes(place as never) ? place : 'block',
    },
    format: '',
  }
}

const BLOCK_BASE = { version: 1, format: '', indent: 0, direction: null }

/** Trims the run's edges and drops what trimming empties. A line break counts as content. */
const trimInline = (nodes: Json[]): Json[] => {
  const out = nodes.map((node) => ({ ...node }))
  const edge = (index: number, side: 'start' | 'end') => {
    const node = out[index]
    if (!node || node.type !== 'text') return
    node.text =
      side === 'start' ? (node.text as string).trimStart() : (node.text as string).trimEnd()
  }
  edge(0, 'start')
  edge(out.length - 1, 'end')
  return out.filter((node) => node.type !== 'text' || node.text !== '')
}

/** Joins neighbouring text with the same look, as the editor itself would hold it. */
const mergeText = (nodes: Json[]): Json[] => {
  const out: Json[] = []
  for (const node of nodes) {
    const previous = out[out.length - 1]
    if (
      previous?.type === 'text' &&
      node.type === 'text' &&
      previous.format === node.format &&
      JSON.stringify(previous.$) === JSON.stringify(node.$)
    ) {
      previous.text = `${previous.text as string}${node.text as string}`
      continue
    }
    out.push(node.type === 'link' ? { ...node, children: mergeText(kids(node)) } : { ...node })
  }
  return out
}

const cleanInline = (nodes: Json[]): Json[] => {
  // Collapse a space that meets another across a boundary, as a browser renders it.
  const merged = mergeText(nodes)
  for (let i = 1; i < merged.length; i++) {
    const previous = merged[i - 1]!
    const node = merged[i]!
    if (
      previous.type === 'text' &&
      node.type === 'text' &&
      (previous.text as string).endsWith(' ') &&
      (node.text as string).startsWith(' ')
    )
      node.text = (node.text as string).slice(1)
  }
  return trimInline(merged)
}

const paragraphNode = (children: Json[], format = ''): Json => ({
  type: 'paragraph',
  ...BLOCK_BASE,
  format,
  textFormat: 0,
  textStyle: '',
  children,
})

const listNode = (element: Element, walker: Walker, images: Json[]): Json => {
  const ordered = element.localName === 'ol'
  const items: Json[] = []
  for (const li of [...element.children]) {
    if (li.localName !== 'li') continue
    readStyle(li, walker, false)
    const nested: Json[] = []
    const holder = li.ownerDocument.createElement('div')
    for (const child of [...li.childNodes]) {
      const tag = child.nodeType === 1 ? (child as Element).localName : ''
      if (tag === 'ul' || tag === 'ol') nested.push(listNode(child as Element, walker, images))
      else holder.append(child.cloneNode(true))
    }
    const found = { inline: [] as Json[], images }
    inlineOf(holder, { bold: false, italic: false, large: false, link: null }, walker, found)
    const words = cleanInline(found.inline)
    if (words.length > 0)
      items.push({ type: 'listitem', ...BLOCK_BASE, value: items.length + 1, children: words })
    for (const sub of nested)
      items.push({ type: 'listitem', ...BLOCK_BASE, value: items.length + 1, children: [sub] })
  }
  return {
    type: 'list',
    listType: ordered ? 'number' : 'bullet',
    tag: ordered ? 'ol' : 'ul',
    start: 1,
    ...BLOCK_BASE,
    children: items,
  }
}

/** Walks block content into top-level nodes. `quoted`: words become quotes, as inside a blockquote. */
const walkBlocks = (node: Node, walker: Walker, out: Json[], quoted = false): void => {
  let pending: Node[] = []

  const flush = (format = '') => {
    if (pending.length === 0) return
    const holder = (node.ownerDocument ?? (node as Document)).createElement('div')
    for (const child of pending) holder.append(child.cloneNode(true))
    pending = []
    const found = { inline: [] as Json[], images: [] as Json[] }
    inlineOf(holder, { bold: false, italic: false, large: false, link: null }, walker, found)
    const words = cleanInline(found.inline)
    if (words.length > 0)
      out.push(
        quoted ? { type: 'quote', ...BLOCK_BASE, children: words } : paragraphNode(words, format),
      )
    out.push(...found.images)
  }

  for (const child of [...node.childNodes]) {
    if (child.nodeType !== 1) {
      if (child.nodeType === 3) pending.push(child)
      continue
    }
    const element = child as Element
    const tag = element.localName

    if (!BLOCKS.has(tag)) {
      pending.push(child)
      continue
    }
    flush()

    if (tag === 'hr') {
      out.push({ type: 'horizontalrule', version: 1 })
      continue
    }
    if (tag === 'img') {
      const image = imageNode(element, walker)
      if (image) out.push(image)
      continue
    }
    if (tag === 'ul' || tag === 'ol') {
      readStyle(element, walker, false)
      const images: Json[] = []
      const list = listNode(element, walker, images)
      if (kids(list).length > 0) out.push(list)
      out.push(...images)
      continue
    }
    if (/^h[1-6]$/.test(tag)) {
      const align = readStyle(element, walker, true)
      if (tag === 'h1') walker.count('heading')
      const level = tag === 'h1' || tag === 'h2' ? 'h2' : tag === 'h3' ? 'h3' : 'h4'
      const found = { inline: [] as Json[], images: [] as Json[] }
      inlineOf(element, { bold: false, italic: false, large: false, link: null }, walker, found)
      const words = cleanInline(found.inline)
      if (words.length > 0)
        out.push({ type: 'heading', tag: level, ...BLOCK_BASE, format: align, children: words })
      out.push(...found.images)
      continue
    }
    if (tag === 'blockquote') {
      readStyle(element, walker, false)
      walkBlocks(element, walker, out, true)
      continue
    }
    if (tag === 'p' || tag === 'li') {
      const align = readStyle(element, walker, !quoted)
      pending = [...element.childNodes]
      flush(align)
      continue
    }
    // A container: transparent — its blocks survive, its loose words become paragraphs.
    readStyle(element, walker, false)
    walkBlocks(element, walker, out, quoted)
  }
  flush()
}

export const htmlToLexical = (
  html: string,
  ctx: SourceContext,
  parse: HtmlParser = defaultParse,
): HtmlSourceResult => {
  const counts = new Map<HtmlSourceRemovalKind, number>()
  const walker: Walker = {
    ctx,
    imageBySrc: new Map([...ctx.images].map(([id, image]) => [image.src, id])),
    count: (kind, n = 1) => {
      if (n > 0) counts.set(kind, (counts.get(kind) ?? 0) + n)
    },
    id: ctx.newId ?? randomId,
  }

  const document = parse(html)
  const body = document.body

  // The whole document: a leading `<script>` or `<style>` is parsed into `<head>`.
  walker.count('script', document.querySelectorAll('script').length)
  walker.count('styling', document.querySelectorAll('style').length)

  const out: Json[] = []
  if (body) {
    for (const [kind, selector] of [
      ['embed', EMBED_SELECTOR],
      ['form', FORM_SELECTOR],
    ] as const) {
      // Outermost only, so a form's fields count once, as the form.
      const found = [...body.querySelectorAll(selector)].filter(
        (element) => !element.parentElement?.closest(selector),
      )
      walker.count(kind, found.length)
      for (const element of found) element.remove()
    }
    walker.count(
      'script',
      [...body.querySelectorAll('*')].filter((element) =>
        [...element.attributes].some((a) => a.name.toLowerCase().startsWith('on')),
      ).length,
    )
    walker.count('attributes', [...body.querySelectorAll('*')].filter(hasOtherAttributes).length)
    walker.count(
      'table',
      [...body.querySelectorAll('table')].filter((t) => !t.parentElement?.closest('table')).length,
    )
    walkBlocks(body, walker, out)
  }

  const removals = ORDER.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind)!,
    message: MESSAGES[kind],
  }))

  return { children: out, removals, empty: out.length === 0 }
}

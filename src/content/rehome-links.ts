import type { PageBlock, RichText, RichTextBlock, RichTextInline, RichTextList } from './types'

/**
 * Reused content's links, made district addresses (Jason, 2026-10-29).
 *
 * A reused page is a district page shown at a school's address. Its links were written for the
 * district site — `/enroll` there is the district's Enroll page, and a link to a page resolves to
 * a district path — so on the school's host every PATH would lead to the school's page of that
 * name, or to nothing. Each one is given the district origin; a full address, `mailto:` and
 * `tel:` are already right and are left alone.
 *
 * PURE, over DD2 domain types, and it builds new values — the page it was handed is unchanged.
 */

const rehomeHref = (href: string, origin: string): string =>
  href.startsWith('/') && !href.startsWith('//') ? `${origin}${href}` : href

type Rewrite = (href: string) => string

const inline = (node: RichTextInline, rewrite: Rewrite): RichTextInline =>
  node.kind === 'link' ? { ...node, href: rewrite(node.href) } : node

const list = (node: RichTextList, rewrite: Rewrite): RichTextList => ({
  ...node,
  items: node.items.map((item) => ({
    children: item.children.map((child) => inline(child, rewrite)),
    list: item.list ? list(item.list, rewrite) : null,
  })),
})

const block = (node: RichTextBlock, rewrite: Rewrite): RichTextBlock =>
  node.kind === 'list'
    ? list(node, rewrite)
    : { ...node, children: node.children.map((child) => inline(child, rewrite)) }

/** Every link in the words, through `rewrite`. */
export const mapRichTextLinks = (words: RichText, rewrite: Rewrite): RichText =>
  words.map((node) => block(node, rewrite))

/** Every link in the blocks — buttons, cards, and the words in text and accordion blocks. */
export const mapBlockLinks = (blocks: readonly PageBlock[], rewrite: Rewrite): PageBlock[] =>
  blocks.map((b): PageBlock => {
    switch (b.kind) {
      case 'richText':
        return { ...b, content: mapRichTextLinks(b.content, rewrite) }
      case 'callToAction':
        return { ...b, href: rewrite(b.href) }
      case 'accordion':
        return {
          ...b,
          items: b.items.map((item) => ({
            ...item,
            content: mapRichTextLinks(item.content, rewrite),
          })),
        }
      case 'cardGrid':
        return {
          ...b,
          cards: b.cards.map((card) => ({
            ...card,
            href: card.href === null ? null : rewrite(card.href),
          })),
        }
      /**
       * The rest carry no path of the district's: a child-page menu lists the SCHOOL page's own
       * children, a video's address is the provider's, and a feed links each announcement home.
       */
      default:
        return b
    }
  })

export const rehomeRichText = (words: RichText, origin: string): RichText =>
  mapRichTextLinks(words, (href) => rehomeHref(href, origin))

export const rehomeBlocks = (blocks: readonly PageBlock[], origin: string): PageBlock[] =>
  mapBlockLinks(blocks, (href) => rehomeHref(href, origin))

import { Heading, clampHeadingLevel, nextHeadingLevel } from '../Heading'
import type { HeadingLevel } from '../Heading'
import { Link } from '../Link'

import styles from './RichText.module.css'

import type {
  RichText as RichTextDoc,
  RichTextAlign,
  RichTextBlock,
  RichTextInline,
  RichTextList,
  RichTextListItem,
} from '@/content/types'

/**
 * Renders a rich-text body.
 *
 * ============================================================================
 * IT CONSUMES DD2 DOMAIN NODES, NEVER LEXICAL EDITOR STATE.
 * The mapping happens once, at the content boundary (`src/content/rich-text.ts`).
 * ============================================================================
 *
 * That is what keeps this component on the public side of the boundary rule: nothing here
 * knows what a Lexical node is, so swapping the CMS changes the mapper and not the renderer
 * (`02` §11, ADR-5).
 *
 * WHAT THIS OWNS, so no template has to remember it:
 *
 *   - **Heading elements.** The author picks "top-level heading" or "sub-heading"; this decides
 *     what element that becomes, from where the body sits in the page outline. An author cannot
 *     reach the element, which is what makes "an editor cannot produce a heading-order
 *     violation" true rather than aspirational (`03` §3, `07` §3).
 *   - **Marks as elements.** `strong` and `em`, not a bold class — emphasis a screen reader can
 *     convey (`07` §4.2).
 *   - **Links through `Link`**, which owns the underline, the new-window announcement, and the
 *     `rel` that must accompany `target`.
 *
 *   - **What the editor added** (Jason, 2026-11-19): alignment as a class (`text-align: center`
 *     or `end`, logical so a translation mirrors), a quotation as `<blockquote>`, a line as
 *     `<hr>`, and a library image as `<img>` with the library's alt text. An image the content
 *     layer has not filled in renders nothing.
 *
 * Paragraph and list spacing live in `src/styles/globals.css`, on the elements themselves; the
 * module holds only what the added features need.
 */

export type RichTextProps = {
  readonly content: RichTextDoc
  /**
   * The element an author's "top-level heading" becomes. Defaults to `h2` — one step below the
   * page title.
   *
   * A prop because body content is not always directly under the title: inside a named
   * `Section` it is already one step down, and the author's h2 has to render as an h3 or the
   * outline lies about the page's structure. Threaded rather than taken from context, because
   * these are server components and server components have no context.
   */
  readonly baseLevel?: HeadingLevel
}

const markUp = (node: Extract<RichTextInline, { kind: 'text' }>) => {
  let out = <>{node.text}</>
  // Innermost first, so both marks nest rather than one replacing the other.
  if (node.marks.includes('em')) out = <em>{out}</em>
  if (node.marks.includes('strong')) out = <strong>{out}</strong>
  // "Large text" (Jason, 2026-11-19): a size from the design, not emphasis — a span, no meaning.
  if (node.marks.includes('large')) out = <span className={styles.large}>{out}</span>
  return out
}

const Inlines = ({ nodes }: { readonly nodes: readonly RichTextInline[] }) => (
  <>
    {nodes.map((node, index) =>
      node.kind === 'link' ? (
        <Link
          href={node.href}
          key={index}
          newWindow={node.newTab}
          {...(node.ariaLabel ? { label: node.ariaLabel } : {})}
        >
          {node.children.map((child, childIndex) => (
            <span key={childIndex}>{markUp(child)}</span>
          ))}
        </Link>
      ) : (
        <span key={index}>{markUp(node)}</span>
      ),
    )}
  </>
)

const Item = ({
  item,
  baseLevel,
}: {
  readonly item: RichTextListItem
  readonly baseLevel: HeadingLevel
}) => (
  <li>
    <Inlines nodes={item.children} />
    {item.list ? <List list={item.list} baseLevel={baseLevel} /> : null}
  </li>
)

/**
 * Nesting is preserved rather than flattened — agendas nest, and flattening turns two levels
 * of meaning into one. Same reason the paste normalizer keeps nested lists (`07` §4.2).
 */
const List = ({
  list,
  baseLevel,
}: {
  readonly list: RichTextList
  readonly baseLevel: HeadingLevel
}) => {
  const Tag = list.ordered ? 'ol' : 'ul'

  return (
    <Tag>
      {list.items.map((item, index) => (
        <Item baseLevel={baseLevel} item={item} key={index} />
      ))}
    </Tag>
  )
}

const alignClass = (align: RichTextAlign | undefined): string | undefined =>
  align === 'center' ? styles.center : align === 'end' ? styles.end : undefined

const Block = ({
  block,
  baseLevel,
}: {
  readonly block: RichTextBlock
  readonly baseLevel: HeadingLevel
}) => {
  if (block.kind === 'heading') {
    /**
     * The author's level 2 is `baseLevel`; their level 3 is one step deeper. `nextHeadingLevel`
     * saturates at h6 rather than emitting an invalid h7 or wrapping to h1.
     */
    // Heading, Subheading, Minor heading: one step deeper each (Jason, 2026-11-19, the third).
    const level =
      block.level === 2
        ? baseLevel
        : block.level === 3
          ? nextHeadingLevel(baseLevel)
          : nextHeadingLevel(nextHeadingLevel(baseLevel))
    const heading = (
      <Heading level={level}>
        <Inlines nodes={block.children} />
      </Heading>
    )
    // `Heading` owns its element and class; alignment is inherited from a plain wrapper.
    return block.align ? <div className={alignClass(block.align)}>{heading}</div> : heading
  }

  if (block.kind === 'list') return <List baseLevel={baseLevel} list={block} />

  if (block.kind === 'quote')
    return (
      <blockquote className={styles.quote}>
        <p>
          <Inlines nodes={block.children} />
        </p>
      </blockquote>
    )

  if (block.kind === 'rule') return <hr className={styles.rule} />

  if (block.kind === 'image') {
    const { image } = block
    if (!image) return null
    return (
      // A library image of any size, held to the text's width, its height following.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={image.alt}
        className={[styles.image, styles[block.size], styles[`at-${block.position}`]]
          .filter(Boolean)
          .join(' ')}
        loading="lazy"
        sizes="(min-width: 48rem) 48rem, 100vw"
        src={image.src}
        {...(image.srcSet ? { srcSet: image.srcSet } : {})}
        {...(image.width ? { width: image.width } : {})}
        {...(image.height ? { height: image.height } : {})}
      />
    )
  }

  return (
    <p className={alignClass(block.align)}>
      <Inlines nodes={block.children} />
    </p>
  )
}

export const RichText = ({ content, baseLevel = 2 }: RichTextProps) => {
  // An empty body is a legitimate value, not an error — a `calendar` page has no prose
  // (`03` §2). Render nothing rather than an empty wrapper that would still take up space.
  if (content.length === 0) return null

  /**
   * Clamped so a caller cannot push the author's headings to h1 and give the page two. The
   * page title owns `h1` (`PAGE_TITLE_LEVEL`).
   */
  const resolved = clampHeadingLevel(Math.max(2, baseLevel))

  const blocks = content.map((block, index) => (
    <Block baseLevel={resolved} block={block} key={index} />
  ))
  /**
   * An image beside the text floats; the words are held in a box of their own then, so the image
   * cannot hang into the next section. Otherwise no wrapper, as before.
   */
  const floats = content.some((block) => block.kind === 'image' && block.position !== 'block')
  return floats ? <div className={styles.flow}>{blocks}</div> : <>{blocks}</>
}

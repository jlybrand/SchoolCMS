import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import type { ChildPageNavBlock, PageLink } from '@/content/types'

import styles from './ChildPageNav.module.css'

/**
 * A menu of the pages beneath the current one (`03` §3.1).
 *
 * ============================================================================
 * THE ONE BLOCK THAT RENDERS SOMETHING IT WAS NOT STORED WITH — and it still
 * does not fetch. The pages arrive as a prop.
 * ============================================================================
 *
 * `src/blocks/` may not import the Payload SDK (CLAUDE.md rule 1), so a block cannot go and
 * get data. The children are part of the page (`Page.children`, resolved in
 * `src/content/pages.ts`) and `BlockList` threads them down, the same way it threads
 * `baseLevel`. `03` §3.3 records why that shape was chosen over two alternatives.
 *
 * A `<nav>`, NOT A LIST OF LINKS IN A DIV. This is a navigation region: a screen-reader user
 * reaches it from the landmark list and skips past it in one keystroke, which a bare list does
 * not offer. That is only true if it has a NAME — the page template already renders a language
 * `<nav>`, and two identically-unnamed landmarks are worse than one.
 *
 * THE TITLES ARE LINKS, NEVER HEADINGS. Nine child pages would otherwise put nine entries in
 * the page outline and bury the page's real structure underneath the menu.
 */

/** Names the landmark when the editor gave the block no heading of its own. */
const FALLBACK_LABEL = 'In this section'

export type ChildPageNavProps = {
  readonly block: ChildPageNavBlock
  /**
   * The current page's children, already filtered to pages with a reachable URL and ordered
   * by the content layer. This component neither sorts nor filters — doing either here would
   * put half the rule in `src/content/` and half in a renderer.
   */
  readonly pages: readonly PageLink[]
  /** From the page outline. The block's own heading, if it has one. */
  readonly baseLevel: HeadingLevel
}

export const ChildPageNav = ({ block, pages, baseLevel }: ChildPageNavProps) => {
  /**
   * A LEAF PAGE CARRYING THIS BLOCK SHOWS NOTHING. Not an empty menu, not a "no pages here"
   * notice — a visitor has no use for either.
   *
   * The drop happens here rather than in the mapper, which is the usual home for it: the
   * mapper sees only the block's own row, and this block's content is not in it. This is the
   * one place that knows the answer (`src/content/blocks.ts`).
   */
  if (pages.length === 0) return null

  const headingId = `${block.id}-heading`

  return (
    <nav
      aria-label={block.heading === null ? FALLBACK_LABEL : undefined}
      /**
       * Named by its own visible heading when it has one, so what a screen reader announces
       * and what is on the screen cannot drift apart.
       */
      aria-labelledby={block.heading === null ? undefined : headingId}
    >
      {block.heading === null ? null : (
        <Heading id={headingId} level={baseLevel}>
          {block.heading}
        </Heading>
      )}

      <ul className={styles.list}>
        {pages.map((page) => (
          <li key={page.id}>
            <Link href={page.path}>{page.title}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

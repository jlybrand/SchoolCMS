import { Heading, nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { RichText } from '@/components/RichText'
import type { AccordionBlock } from '@/content/types'

import styles from './Accordion.module.css'

/**
 * Stacked disclosures — the FAQ shape (`03` §3.1).
 *
 * BUILT ON `<details>`/`<summary>`, NOT ON A SCRIPTED WIDGET. The browser supplies the
 * expand/collapse, the keyboard behaviour, and the expanded/collapsed announcement, so the
 * block works before hydration and cannot drift out of conformance when the JS changes. A
 * hand-rolled `aria-expanded` disclosure would be more code, more to get wrong, and no more
 * accessible.
 *
 * THE QUESTION IS A HEADING INSIDE THE SUMMARY. `<summary>` accepts heading content, and
 * putting it there keeps every question in the page outline, which is how a screen-reader
 * user finds one without tabbing through all of them. The alternative — plain bold text —
 * looks identical and removes the whole set from the outline.
 *
 * Each answer is `RichText` one level deeper again, so an author's sub-headings inside an
 * answer sit below the question they belong to.
 */

export type AccordionProps = {
  readonly block: AccordionBlock
  /** From the page outline. The block's own heading, or its questions if it has none. */
  readonly baseLevel: HeadingLevel
}

export const Accordion = ({ block, baseLevel }: AccordionProps) => {
  /**
   * Questions sit one level below the set's heading — but only if there IS one. Without it
   * the questions are the block's top level, and skipping a level to leave room for a heading
   * that does not exist is exactly the outline gap `07` §3 rules out.
   */
  const itemLevel = block.heading === null ? baseLevel : nextHeadingLevel(baseLevel)

  return (
    <div>
      {block.heading === null ? null : <Heading level={baseLevel}>{block.heading}</Heading>}

      <div className={styles.items}>
        {block.items.map((item, index) => (
          <details className={styles.item} key={index}>
            <summary className={styles.summary}>
              <Heading level={itemLevel} size="lg">
                {item.heading}
              </Heading>
            </summary>

            <div className={styles.answer}>
              <RichText baseLevel={nextHeadingLevel(itemLevel)} content={item.content} />
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

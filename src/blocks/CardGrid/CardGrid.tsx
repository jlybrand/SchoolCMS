import { Heading, nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import type { CardGridBlock } from '@/content/types'

import styles from './CardGrid.module.css'

/**
 * A grid of short, parallel items — programs, departments, quick links (`03` §3.1).
 *
 * A LIST, NOT A ROW OF DIVS. A screen reader announces "list, 6 items" and lets the user skip
 * the set, which is the difference between scanning six cards and hearing all of them. The
 * grid is `display: grid` on the `<ul>`, so the semantics and the layout do not compete.
 *
 * THE LINK IS ON THE TITLE, NOT THE WHOLE CARD. A card-sized click target is nicer with a
 * mouse and worse with everything else: it either swallows the blurb into the link's
 * accessible name, or needs a script and an overlay that breaks text selection. A card is a
 * heading that happens to link.
 *
 * TEXT-ONLY IN BATCH 1 — the image field arrives with `media` in Phase 6 (`03` §3.1).
 */

export type CardGridProps = {
  readonly block: CardGridBlock
  /** From the page outline. The block's own heading, or its card titles if it has none. */
  readonly baseLevel: HeadingLevel
}

export const CardGrid = ({ block, baseLevel }: CardGridProps) => {
  // Same rule as `Accordion`: no set heading means the cards ARE the block's top level.
  const cardLevel = block.heading === null ? baseLevel : nextHeadingLevel(baseLevel)

  return (
    <div>
      {block.heading === null ? null : <Heading level={baseLevel}>{block.heading}</Heading>}

      <ul className={styles.grid}>
        {block.cards.map((card, index) => (
          <li className={styles.card} key={index}>
            <Heading level={cardLevel} size="lg">
              {card.href === null ? card.title : <Link href={card.href}>{card.title}</Link>}
            </Heading>

            {card.text === null ? null : <p className={styles.text}>{card.text}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

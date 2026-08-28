import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import type { CallToActionBlock } from '@/content/types'

import styles from './CallToAction.module.css'

/**
 * One decision, presented once (`03` §3.1).
 *
 * WHY THE BUTTON IS A LINK. It navigates, so it is an `<a>` wearing a button's clothes — not
 * a `<button>`, and not a `<div>` with a click handler. A screen reader announces "link",
 * middle-click opens it in a tab, and it works before hydration. The styling is the only part
 * that is button-shaped.
 *
 * WHY THERE IS NO SECOND LINK. `text` is a plain string rather than rich text (see
 * `src/content/types.ts`): a second destination inside a block whose job is to present one
 * competes with the button for the same decision.
 *
 * The heading is optional because the mapper keeps a call to action that lost its heading —
 * the link is the block, and the words that remain are still content.
 */

export type CallToActionProps = {
  readonly block: CallToActionBlock
  /** From the page outline. The block's own heading becomes this element. */
  readonly baseLevel: HeadingLevel
}

export const CallToAction = ({ block, baseLevel }: CallToActionProps) => (
  <div className={styles.callToAction}>
    {block.heading === null ? null : (
      <Heading level={baseLevel} size="lg">
        {block.heading}
      </Heading>
    )}

    {block.text === null ? null : <p className={styles.text}>{block.text}</p>}

    {/*
      `Link` owns the new-window announcement, the `rel` that must accompany `target`, and
      the button presentation itself (`variant`). This block passes intent, never styling —
      it cannot reach in and remove the underline rule, because there is no prop for it.
    */}
    <p className={styles.action}>
      <Link href={block.href} newWindow={block.newTab} variant="button">
        {block.linkLabel}
      </Link>
    </p>
  </div>
)

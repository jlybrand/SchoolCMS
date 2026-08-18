import type { ReactNode } from 'react'

import { Heading } from '../Heading'
import type { HeadingLevel } from '../Heading'

/**
 * A titled region of a page — the unit blocks compose into (`07` §3).
 *
 * It carries one decision that would otherwise be re-made by every block author: **a
 * landmark is only useful if it has an accessible name.** An unnamed `<section>` adds a
 * "region" to the screen-reader landmark list with nothing to distinguish it from the others,
 * so a section without a heading renders no landmark at all.
 *
 * The name is a reference to the visible heading (`aria-labelledby`) rather than a copy of
 * it (`aria-label`), so it cannot drift from what is on screen — including once headings are
 * machine-translated (`08` §4).
 *
 * `headingId` is required alongside `heading` rather than generated. `useId` is a hook and
 * these render as server components; deriving an id from the heading text would collide on
 * the pages most likely to have repeated headings. Templates already hold stable ids — a
 * page slug, a block id — so the caller passes one.
 */

type SectionBase = {
  /** From the page outline. Nested sections receive `nextHeadingLevel(level)`. */
  readonly level: HeadingLevel
  readonly children: ReactNode
}

export type SectionProps = SectionBase &
  (
    | { readonly heading: ReactNode; readonly headingId: string }
    | { readonly heading?: undefined; readonly headingId?: undefined }
  )

export const Section = ({ level, heading, headingId, children }: SectionProps) => {
  if (heading === undefined) return <div>{children}</div>

  return (
    <section aria-labelledby={headingId}>
      <Heading level={level} id={headingId}>
        {heading}
      </Heading>
      {children}
    </section>
  )
}

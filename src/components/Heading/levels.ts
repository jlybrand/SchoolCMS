/**
 * Heading levels are owned by the rendering layer, never by an editor (`03` §3, `07` §3).
 *
 * The conformance claim this backs — "an editor cannot produce a heading-order violation by
 * reordering blocks" — holds because no block exposes a heading level as a field. A level is
 * derived from position in the page outline and threaded down as a prop.
 *
 * A prop rather than React context, because blocks render as server components and server
 * components have no context. Threading is the only mechanism available in an RSC tree, and
 * it keeps the outline visible in the template that owns it instead of hidden in a provider.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

/** The page title. One per page, rendered by the template rather than by a block. */
export const PAGE_TITLE_LEVEL: HeadingLevel = 1

/** A top-level block's own heading — one step below the page title. */
export const BLOCK_HEADING_LEVEL: HeadingLevel = 2

export const clampHeadingLevel = (level: number): HeadingLevel =>
  Math.min(6, Math.max(1, Math.round(level))) as HeadingLevel

/**
 * The level for content nested one step deeper.
 *
 * Saturates at `h6`: repeated `h6` in very deep nesting is a flat outline, which is a
 * cosmetic loss. An `h7` is invalid, and wrapping back to `h1` would be the exact
 * heading-order violation this module exists to make impossible.
 */
export const nextHeadingLevel = (level: HeadingLevel): HeadingLevel => clampHeadingLevel(level + 1)

/**
 * THE DISTRICT BLOCK LIBRARY (`03` §3).
 *
 * The register in `03` §3.1 is the source of truth for what exists and what is deliberately
 * absent. Every block here ships with a Storybook entry and an axe test in the same PR
 * (CLAUDE.md), and none of them exposes a heading level, a nesting slot, or a styling field.
 *
 * This directory may not import the Payload SDK. The schema half of each block lives in
 * `src/collections/blocks/`, and the two are joined by `src/content/blocks.ts`.
 */

export { BlockList } from './BlockList'
export type { BlockListProps } from './BlockList'
export { Accordion } from './Accordion'
export { CallToAction } from './CallToAction'
export { CardGrid } from './CardGrid'
export { ChildPageNav } from './ChildPageNav'
export { Divider } from './Divider'
export { Embed } from './Embed'
export { NewsFeed } from './NewsFeed'
export { RichTextBlock } from './RichTextBlock'

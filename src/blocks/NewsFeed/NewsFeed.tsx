import { nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import { NewsList } from '@/components/NewsList'
import { Section } from '@/components/Section'
import { Stack } from '@/components/Stack'
import type { ResolvedFeedBlock } from '@/content/types'

/**
 * A news feed on a page (Jason, 2026-10-28) — e.g. SHS's homepage showing District News tagged
 * "High". Finalsite calls this a post element.
 *
 * HANDED ITS ANNOUNCEMENTS, never fetching them: `resolvePageBlocks` ran the feed's query and
 * made each one ready (link, date, summary). This component only lays them out (CLAUDE.md rule 1).
 *
 * THE OUTLINE: a named region whose heading is the block's level and whose headlines sit one
 * below it; with no heading, the headlines take the block's level. Either way no level is
 * skipped, wherever an editor places it (`03` §3.2).
 *
 * NOTHING TO SHOW, NOTHING RENDERED (Jason, 2026-10-28). The resolve pass drops an empty feed;
 * this agrees, because the component is exported and can be rendered directly.
 */
export type NewsFeedProps = {
  readonly block: ResolvedFeedBlock
  readonly baseLevel: HeadingLevel
}

/** Never shown — an empty feed renders nothing — but `NewsList` asks for one. */
const UNUSED_EMPTY = ''

export const NewsFeed = ({ block, baseLevel }: NewsFeedProps) => {
  if (block.items.length === 0) return null

  const body = (level: HeadingLevel) => (
    <Stack space="md">
      <NewsList items={block.items} level={level} empty={UNUSED_EMPTY} />
      <p>
        <Link href={block.moreHref}>More news</Link>
      </p>
    </Stack>
  )

  if (block.heading === null) return body(baseLevel)

  return (
    <Section heading={block.heading} headingId={`${block.id}-heading`} level={baseLevel}>
      {body(nextHeadingLevel(baseLevel))}
    </Section>
  )
}

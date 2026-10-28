import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import { PublishedDate } from '@/components/PublishedDate'
import type { NewsItem } from '@/lib/post-url'

import styles from './NewsList.module.css'

/**
 * A list of announcements (Jason, 2026-10-28) — the `/news` page today, a feed tomorrow.
 *
 * EACH HEADLINE IS A HEADING, at `level`. Unlike a section menu (`ChildPageNav`), these are the
 * page's content: a screen-reader user moving by heading should land on each announcement. The
 * caller passes the level from its outline, so a list under an `h2` cannot produce a skipped
 * level wherever it is placed (`03` §3.2).
 *
 * A REAL LIST, so its length is announced ("list, 8 items") before the first headline.
 *
 * Fetches nothing and decides nothing: links, dates and summaries arrive ready (`toNewsItems`).
 */
export type NewsListProps = {
  readonly items: readonly NewsItem[]
  /** The level of each headline, from the page outline. */
  readonly level: HeadingLevel
  /** Shown when there is nothing to list — a sentence, so the page is not silently empty. */
  readonly empty: string
}

export const NewsList = ({ items, level, empty }: NewsListProps) => {
  if (items.length === 0) return <p className={styles.empty}>{empty}</p>

  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li className={styles.item} key={item.id}>
          <Heading level={level} size="lg">
            {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
          </Heading>
          {item.date ? <PublishedDate iso={item.date.iso} label={item.date.label} /> : null}
          {item.summary ? <p className={styles.summary}>{item.summary}</p> : null}
        </li>
      ))}
    </ul>
  )
}

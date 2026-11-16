import { Heading } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import type { SearchResult } from '@/content/types'

import styles from './SearchResults.module.css'

/**
 * Site search results (Jason, 2026-11-16; Phase 6 D) — an ORDERED list, numbered from where this
 * page of results starts, so "11." follows "10." across pages and a screen reader announces the
 * count.
 *
 * EACH RESULT says what kind of thing it is (Page, Announcement, Event, Document) and, when it is
 * another site's, which site — in words, never by color alone. Its title is a heading at `level`
 * (the page's outline gives it), linking to it; an event whose calendar no page shows has no link.
 * The words around the match follow, the matched words in `<mark>`, as text.
 *
 * Handed its results, ready (`searchSite`); fetches and decides nothing (CLAUDE.md rule 1).
 */
export type SearchResultsProps = {
  readonly results: readonly SearchResult[]
  /** The number of the first result on this page (11 on page two). */
  readonly start: number
  readonly level: HeadingLevel
}

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  page: 'Page',
  post: 'Announcement',
  event: 'Event',
  document: 'Document',
}

export const SearchResults = ({ results, start, level }: SearchResultsProps) => (
  <ol className={styles.list} start={start}>
    {results.map((result) => (
      <li className={styles.item} key={result.id}>
        <p className={styles.meta}>
          {KIND_LABEL[result.kind]}
          {result.file ? ` · ${result.file}` : null}
          {result.siteName ? ` · ${result.siteName}` : null}
        </p>
        <Heading level={level} size="lg">
          {result.href ? <Link href={result.href}>{result.title}</Link> : result.title}
        </Heading>
        {result.event ? (
          <p className={styles.event}>
            {[result.event.when, result.event.location].filter(Boolean).join(' · ')}
          </p>
        ) : null}
        {result.snippet.length > 0 ? (
          <p className={styles.snippet}>
            {result.snippet.map((part, index) =>
              part.match ? <mark key={index}>{part.text}</mark> : part.text,
            )}
          </p>
        ) : null}
      </li>
    ))}
  </ol>
)

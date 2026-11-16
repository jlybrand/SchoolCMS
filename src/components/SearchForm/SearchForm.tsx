import { VisuallyHidden } from '@/components/VisuallyHidden'

import styles from './SearchForm.module.css'

/**
 * The site search box (Jason, 2026-11-16; Phase 6 D) — in every site's header, and at the top of
 * the results page.
 *
 * A PLAIN GET FORM to the results page: it works with no JavaScript, and the results have an
 * address a visitor can bookmark or share.
 *
 * A NAMED `search` LANDMARK. The results page has two — the header's and its own — so each carries
 * its own name (`landmark`) and a screen-reader user can tell them apart.
 *
 * THE LABEL IS ALWAYS THERE: visible on the results page; in the header, read but not shown,
 * beside a visible "Search" button whose name matches it (2.5.3). The field is `type="search"`, so
 * phones show a search key.
 *
 * Fetches nothing (CLAUDE.md rule 1): the caller gives the action, which is a site path.
 */
export type SearchFormProps = {
  /** The results page, in the visitor's language — `searchHref`'s path. */
  readonly action: string
  /** The landmark's name, e.g. "Site search". */
  readonly landmark: string
  /** The field's label. */
  readonly label?: string
  /** Show the label above the field (the results page) rather than only reading it (the header). */
  readonly showLabel?: boolean
  /** The words already searched for. */
  readonly query?: string | null
  /** Kept when a search is refined: `all` to stay across every site. */
  readonly scope?: string | null
  /** Unique on the page — the header's and the page's forms coexist. */
  readonly id: string
}

export const SearchForm = ({
  action,
  landmark,
  label = 'Search this site',
  showLabel = false,
  query = null,
  scope = null,
  id,
}: SearchFormProps) => (
  <form action={action} aria-label={landmark} className={styles.form} method="get" role="search">
    <label className={showLabel ? styles.label : undefined} htmlFor={id}>
      {showLabel ? label : <VisuallyHidden>{label}</VisuallyHidden>}
    </label>
    <div className={styles.row}>
      <input
        autoComplete="off"
        className={styles.input}
        defaultValue={query ?? ''}
        enterKeyHint="search"
        id={id}
        maxLength={200}
        name="q"
        type="search"
      />
      {scope ? <input name="scope" type="hidden" value={scope} /> : null}
      <button className={styles.button} type="submit">
        Search
      </button>
    </div>
  </form>
)

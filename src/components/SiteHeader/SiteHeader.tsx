import { Container } from '@/components/Container'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Link } from '@/components/Link'
import { MenuList } from '@/components/MenuList'
import { SearchForm } from '@/components/SearchForm'
import type { Locale, MenuLink } from '@/content/types'
import { localizedPath } from '@/lib/locales'
import { SEARCH_PATH } from '@/lib/search'

import styles from './SiteHeader.module.css'

/**
 * The site header — the banner landmark (`03` §5, `07` §3).
 *
 * THE SITE NAME IS A LINK, NOT A HEADING. The page title is each page's only `h1`
 * (`PAGE_TITLE_LEVEL`); a site name in an `h1` would put the same heading at the top of
 * every page's outline and push the one that differs to second place.
 *
 * DOM ORDER IS name -> quick links -> languages -> search -> main menu, and it is also the visual
 * order (the search box joined 2026-11-16, Phase 6 D): nothing
 * here is reordered with `order` or positioned out of flow, so a keyboard user tabs through
 * what a sighted user sees, in the sequence they see it (1.3.2, 2.4.3).
 *
 * Takes menus as props and fetches nothing — `src/components/` may not import the Payload
 * SDK (CLAUDE.md rule 1). The page template resolves them through `src/content/navigation`.
 */

export type SiteHeaderProps = {
  /** The tenant's name. Links to the front page in the current locale. */
  readonly siteName: string
  readonly primary: readonly MenuLink[]
  readonly utility: readonly MenuLink[]
  /** The unprefixed path of the page being rendered — see `MenuList`. */
  readonly currentPath: string
  readonly locale: Locale
  /**
   * The languages this site offers. REQUIRED rather than defaulted, because a forgotten prop
   * would silently hide the switcher — and the failure this platform accepts is offering too
   * many languages, never too few (`08` §10).
   */
  readonly locales: readonly Locale[]
  /** Landmark names. Props because they are visitor-facing text (`08` §4). */
  readonly primaryLabel?: string
  readonly utilityLabel?: string
}

export const SiteHeader = ({
  siteName,
  primary,
  utility,
  currentPath,
  locale,
  locales,
  primaryLabel = 'Main',
  utilityLabel = 'Quick links',
}: SiteHeaderProps) => (
  <header className={styles.header}>
    <Container width="wide">
      <div className={styles.top}>
        <p className={styles.siteName}>
          <Link href={localizedPath('/', locale)}>{siteName}</Link>
        </p>
        <div className={styles.tools}>
          <MenuList
            label={utilityLabel}
            links={utility}
            currentPath={currentPath}
            locale={locale}
          />
          <LanguageSwitcher locales={locales} locale={locale} currentPath={currentPath} />
          {/* Site search (Phase 6 D): a GET form to this site's results page, no JS needed. */}
          <SearchForm
            action={localizedPath(SEARCH_PATH, locale)}
            id="site-search"
            landmark="Site search"
          />
        </div>
      </div>
      <MenuList label={primaryLabel} links={primary} currentPath={currentPath} locale={locale} />
    </Container>
  </header>
)

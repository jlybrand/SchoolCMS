import { Link } from '@/components/Link'
import type { Locale } from '@/content/types'
import { LOCALE_NAMES, localizedPath } from '@/lib/locales'

import styles from './LanguageSwitcher.module.css'

/**
 * The language switcher (`08` §6) — this page, in each language the site offers.
 *
 * SITE CHROME, NOT PAGE CONTENT. A visitor who cannot read the page has to find this without
 * reading the page, so it lives in the banner beside the other ways around the site, and is
 * reached on every page in the same place (3.2.3).
 *
 * Each language is listed in its OWN script and language, with `lang` on each link. Never
 * flag icons (a flag is a country, not a language) and never "translate this page" as the
 * only affordance. The labels are deliberately never translated; that is what a language
 * switcher is for.
 *
 * Built from the page's resolved path rather than the requested one, so every link points at
 * this page in another language. The language being read is marked current: it IS this page.
 */

export type LanguageSwitcherProps = {
  /** The languages this site offers, from its settings. One language is not a choice. */
  readonly locales: readonly Locale[]
  /** The language being read. */
  readonly locale: Locale
  /** The unprefixed path of the page being rendered, as `Page.path` has it. */
  readonly currentPath: string
  /**
   * The landmark's name. Left in English for now, like the other landmark names; which
   * language a visitor who cannot read the page hears it in is a Phase 7 question (`08` §4).
   */
  readonly label?: string
}

export const LanguageSwitcher = ({
  locales,
  locale,
  currentPath,
  label = 'Language',
}: LanguageSwitcherProps) => {
  if (locales.length < 2) return null

  return (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {locales.map((code) => (
          <li key={code}>
            <Link
              current={code === locale}
              href={localizedPath(currentPath, code)}
              hrefLang={code}
              lang={code}
            >
              {LOCALE_NAMES[code] ?? code}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

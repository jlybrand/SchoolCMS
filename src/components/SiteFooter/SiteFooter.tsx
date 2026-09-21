import { Container } from '@/components/Container'
import { MenuList } from '@/components/MenuList'
import type { Locale, MenuLink } from '@/content/types'

import styles from './SiteFooter.module.css'

/**
 * The site footer — the contentinfo landmark (`03` §5, `07` §3).
 *
 * Holds the footer menu and the site's name. The contact block, social links and the
 * accessibility statement link belong here too and arrive with the `settings` record
 * (`03` §5) — they are not invented as props now.
 *
 * Like `SiteHeader`, it takes its links as a prop and fetches nothing (CLAUDE.md rule 1).
 */

export type SiteFooterProps = {
  readonly siteName: string
  readonly links: readonly MenuLink[]
  /** The unprefixed path of the page being rendered — see `MenuList`. */
  readonly currentPath: string
  readonly locale: Locale
  /** The landmark's name. A prop because it is visitor-facing text (`08` §4). */
  readonly label?: string
}

export const SiteFooter = ({
  siteName,
  links,
  currentPath,
  locale,
  label = 'Footer',
}: SiteFooterProps) => (
  <footer className={styles.footer}>
    <Container width="wide">
      <MenuList label={label} links={links} currentPath={currentPath} locale={locale} />
      <p className={styles.siteName}>{siteName}</p>
    </Container>
  </footer>
)

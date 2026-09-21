import { Link } from '@/components/Link'
import type { Locale, MenuLink } from '@/content/types'
import { isSitePath } from '@/lib/href'
import { localizedPath } from '@/lib/locales'

import styles from './MenuList.module.css'

/**
 * One site menu: a named `<nav>` around a list of links (`03` §5).
 *
 * Shared by the header and the footer so the three rules below are written once.
 *
 *   - **The landmark always has a name.** A page carries up to five `<nav>`s — main, quick
 *     links, footer, language, and a `ChildPageNav` — and unnamed they are five identical
 *     entries in the landmark list. `label` is required for that reason.
 *   - **An empty menu renders NOTHING**, not an empty landmark. A `<nav>` with no links is a
 *     stop in the landmark list that leads nowhere, and a tenant created this morning has
 *     three of them.
 *   - **Site paths take the locale prefix; nothing else does.** `/about` on a Spanish page is
 *     `/es/about`; the enrollment portal, a `tel:` and a `mailto:` pass through (`08` §5).
 *
 * A FLAT LIST. No disclosure, no dropdown, no client script — see `MenuLink`.
 */

export type MenuListProps = {
  /** The landmark's accessible name. Visitor-facing, so Phase 7 translates it (`08` §4). */
  readonly label: string
  readonly links: readonly MenuLink[]
  /**
   * The unprefixed path of the page being rendered, as `Page.path` has it. Compared against
   * each link's own unprefixed `href`, so the current-page marker works identically in every
   * locale.
   */
  readonly currentPath: string
  readonly locale: Locale
}

export const MenuList = ({ label, links, currentPath, locale }: MenuListProps) => {
  if (links.length === 0) return null

  return (
    <nav aria-label={label}>
      <ul className={styles.list}>
        {links.map((link) => (
          <li key={link.id}>
            <Link
              /**
               * EXACT match only. Marking `/about` current on `/about/staff` would announce
               * "current page" for a page the visitor is not on.
               */
              current={link.href === currentPath}
              href={isSitePath(link.href) ? localizedPath(link.href, locale) : link.href}
              newWindow={link.newTab}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

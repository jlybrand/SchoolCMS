'use client'

import { GridViewIcon } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import styles from './Nav.module.css'

/**
 * The way home, at the very top of the side navigation (`admin.components.beforeNav`, above the
 * multi-tenant plugin's "Filter by Tenant") —
 * for both planes (Jason, 2026-11-12: an icon that signifies dashboard, at the top, district and
 * school alike). `/admin` is each plane's home: the district dashboard, or a school manager's own
 * home screen (`src/admin/SchoolPlane/SchoolHome.tsx`).
 *
 * Icon only, so the LINK carries the name ("Dashboard") and the icon is hidden from assistive
 * technology; `title` says the same to a mouse user hovering over it. Marked current on the home
 * screen itself, as Payload's own links are.
 */
export const DashboardNavLink = () => {
  const pathname = usePathname()
  const current = pathname === '/admin' || pathname === '/admin/'
  return (
    <Link
      aria-current={current ? 'page' : undefined}
      aria-label="Dashboard"
      className={styles.dashboard}
      href="/admin"
      id="nav-dashboard"
      title="Dashboard"
    >
      <span aria-hidden="true" className={styles.icon}>
        <GridViewIcon />
      </span>
    </Link>
  )
}

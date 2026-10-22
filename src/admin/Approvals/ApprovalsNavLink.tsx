'use client'

import { useAuth } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import styles from './Approvals.module.css'

/**
 * "Approvals" in the district's side navigation (`admin.components.afterNavLinks`), so the
 * queue is one click from anywhere in the admin, not only from the dashboard.
 */
export const ApprovalsNavLink = () => {
  const { user } = useAuth()
  const pathname = usePathname()
  if (!isDistrictAdmin(user as AuthUser | null)) return null

  const current = pathname === '/admin/approvals'
  return (
    <Link
      aria-current={current ? 'page' : undefined}
      className={`nav__link ${styles.navLink}`}
      href="/admin/approvals"
      id="nav-approvals"
    >
      Approvals
    </Link>
  )
}

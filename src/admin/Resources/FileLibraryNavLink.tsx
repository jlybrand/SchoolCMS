'use client'

import { useAuth } from '@payloadcms/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { isDistrictAdmin, isSchoolManager } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * "File library" in the side navigation, both planes (Jason, 2026-11-17) — the screen that shows
 * a site's folders, its files, and a file's details in place. Beside Payload's own Files list.
 */
export const FileLibraryNavLink = () => {
  const { user } = useAuth()
  const pathname = usePathname()
  const who = user as AuthUser | null
  if (!isDistrictAdmin(who) && !isSchoolManager(who)) return null
  return (
    <Link
      aria-current={pathname === '/admin/file-library' ? 'page' : undefined}
      className="nav__link"
      href="/admin/file-library"
      id="nav-file-library"
    >
      File library
    </Link>
  )
}

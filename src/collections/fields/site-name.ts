import type { UIField } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * Which site this document belongs to, at the top of its form (Jason, 2026-11-18: after Pages →
 * a site → a page, "it is hard to determine what site's page is being edited other than looking
 * at the select in the left menu"). Display only — a `ui` field stores nothing.
 *
 * District admins only: they work across every site; a school manager has one school, already
 * named in their menu (`SchoolNameNav`). Shown on pages, announcements and events.
 */
export const siteNameField = (): UIField => ({
  name: 'siteName',
  type: 'ui',
  admin: {
    condition: (_data, _siblingData, { user }) => isDistrictAdmin(user as AuthUser | null),
    components: { Field: '/admin/SiteName/SiteNameField#SiteNameField' },
  },
})

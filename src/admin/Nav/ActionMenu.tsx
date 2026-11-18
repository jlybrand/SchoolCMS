import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { schoolsOf } from '@/admin/SchoolPlane/school-data'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'
import { siteChoices } from '@/admin/SitePages/site-pages'

import { ActionMenuLinks } from './ActionMenuLinks'

/**
 * The short menu of actions at the top of the side navigation (Jason, 2026-11-13; scope settled
 * 2026-11-18), in place of Payload's collection list, which sits folded under "Everything else"
 * (`EverythingElse`). `admin.components.beforeNavLinks`. The district's menu, or a school
 * manager's — the same, less what is the district's (Jason, 2026-11-18).
 *
 * Here only the sites are read, for the panel beside the menu: every site for the district (as
 * the user, so access decides), a school manager's own school for them — one, so their Pages
 * opens straight on its pages.
 */
export const ActionMenu = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  const me = user as AuthUser | null
  if (isDistrictAdmin(me)) {
    const tenants = await payload.find({
      collection: 'tenants',
      user,
      overrideAccess: false,
      depth: 0,
      pagination: false,
      select: { name: true, type: true },
    })
    return <ActionMenuLinks plane="district" sites={siteChoices(tenants.docs)} />
  }
  if (sendsForApproval(me)) {
    const schools = await schoolsOf(payload, me)
    return <ActionMenuLinks plane="school" sites={siteChoices(schools)} />
  }
  return null
}

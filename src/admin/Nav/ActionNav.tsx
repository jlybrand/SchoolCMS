import { DefaultNav } from '@payloadcms/next/rsc'
import type { ComponentProps } from 'react'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

type Props = ComponentProps<typeof DefaultNav>

/**
 * The side navigation (`admin.components.Nav`): Payload's own, with one change for the district
 * AND school managers (Jason, 2026-11-18). Their collection groups move under "Everything else"
 * (`EverythingElse`, in `afterNavLinks`) so the short menu of actions (`ActionMenu`, in
 * `beforeNavLinks`) comes first. Here Payload's nav is told there is nothing to group, so it does
 * not draw them twice; everything else it draws — the dashboard link, the tenant box, the links
 * around the groups, log out, the mobile toggle — is untouched.
 *
 * Anyone else gets Payload's navigation as is.
 */
export const ActionNav = (props: Props) => {
  const me = props.user as AuthUser | null
  if (!isDistrictAdmin(me) && !sendsForApproval(me)) return <DefaultNav {...props} />
  return <DefaultNav {...props} visibleEntities={{ collections: [], globals: [] }} />
}

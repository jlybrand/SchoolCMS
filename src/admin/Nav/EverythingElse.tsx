import { DefaultNavClient } from '@payloadcms/next/client'
import { getNavGroups, getVisibleEntities } from '@payloadcms/ui/shared'
import type { Payload, PayloadRequest, SanitizedPermissions, ServerProps } from 'payload'
import { PREFERENCE_KEYS } from 'payload/shared'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { EverythingElseFold } from './EverythingElseFold'

/** The fold's label; Payload remembers its open state under it, as for its own groups. */
export const EVERYTHING_ELSE = 'Everything else'

type NavPreferences = { groups?: Record<string, { open?: boolean }> } | null

/**
 * Payload's collection list, district and school managers alike, folded under one "Everything
 * else" (Jason, 2026-11-18: kept, so nothing is unreachable, but below the short menu of actions —
 * `ActionMenu`). `admin.components.afterNavLinks`; `ActionNav` keeps Payload's nav from drawing
 * the same groups above.
 *
 * Payload's own pieces throughout: its grouping (`getNavGroups` over `getVisibleEntities`), its
 * links (`DefaultNavClient`, which marks the current one). The fold is ours (`EverythingElseFold`,
 * a `<details>`; Payload's `NavGroup` does not announce open or closed). CLOSED until opened; once
 * opened it stays open for that person, in the same `nav` preference Payload keeps its groups in —
 * read here as Payload's unexported `getNavPrefs` reads it.
 */
export const EverythingElse = async ({
  i18n,
  payload,
  permissions,
  user,
}: {
  i18n: ServerProps['i18n']
  payload: Payload
  permissions: SanitizedPermissions
  user: PayloadRequest['user']
}) => {
  const me = user as AuthUser | null
  if ((!isDistrictAdmin(me) && !sendsForApproval(me)) || !user) return null

  const visible = getVisibleEntities({ req: { payload, user } as PayloadRequest })
  const groups = getNavGroups(permissions, visible, payload.config, i18n)
  if (groups.length === 0) return null

  const found = await payload.find({
    collection: 'payload-preferences',
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
    where: {
      and: [
        { key: { equals: PREFERENCE_KEYS.NAV } },
        { 'user.relationTo': { equals: user.collection } },
        { 'user.value': { equals: user.id } },
      ],
    },
  })
  const prefs = (found.docs[0]?.value ?? null) as NavPreferences

  return (
    <EverythingElseFold
      label={EVERYTHING_ELSE}
      open={prefs?.groups?.[EVERYTHING_ELSE]?.open ?? false}
    >
      <DefaultNavClient groups={groups} navPreferences={prefs as never} />
    </EverythingElseFold>
  )
}

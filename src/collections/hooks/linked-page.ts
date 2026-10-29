import type { RadioFieldValidation } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { validateLinkTarget, type LinkTargetFacts } from '@/lib/linked-page'

/**
 * Server-side check of a linked page's target (Jason, 2026-10-29), on the `linkMode` field so
 * the message sits beside the choice. The rules are `validateLinkTarget`; this looks up the
 * facts it needs as the platform.
 *
 * A partial update may not resend the tenant or the target, so anything the write leaves out is
 * read from the stored page — the same reason `src/lib/page-link.ts` reads its owner.
 */

type PageFields = {
  tenant?: unknown
  linkTo?: unknown
  linkTarget?: unknown
  districtLinkTarget?: unknown
}

export const validateLinkMode: RadioFieldValidation = async (value, { data, id, req }) => {
  if (value !== 'redirect') return true

  const sent = (data ?? {}) as PageFields
  const stored =
    id === undefined || id === null
      ? {}
      : (((await req.payload
          .findByID({ collection: 'pages', id, depth: 0, draft: true, overrideAccess: true, req })
          .catch(() => null)) ?? {}) as PageFields)
  const pick = <K extends keyof PageFields>(key: K): unknown =>
    key in sent ? sent[key] : stored[key]

  const linkTo = pick('linkTo') === 'district' ? 'district' : 'site'
  const targetId = relationshipIdOf(
    (linkTo === 'district' ? pick('districtLinkTarget') : pick('linkTarget')) as never,
  )

  let target: LinkTargetFacts | null = null
  if (targetId !== null) {
    const doc = (await req.payload
      .findByID({ collection: 'pages', id: targetId, depth: 1, overrideAccess: true, req })
      .catch(() => null)) as { id: unknown; tenant?: unknown; linkMode?: unknown } | null
    if (doc) {
      const tenant = doc.tenant as { id?: unknown; type?: unknown } | number | string | null
      target = {
        id: String(doc.id),
        tenant: relationshipIdOf(tenant as never),
        tenantType:
          typeof tenant === 'object' &&
          tenant !== null &&
          (tenant.type === 'district' || tenant.type === 'school')
            ? tenant.type
            : null,
        linkMode: doc.linkMode === 'redirect' ? 'redirect' : 'none',
      }
    }
  }

  return validateLinkTarget(
    {
      mode: value,
      linkTo,
      pageId: id === undefined || id === null ? null : String(id),
      pageTenant: relationshipIdOf(pick('tenant') as never),
      targetId,
    },
    target,
  )
}

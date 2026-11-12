import type { UIField } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * The review panel on a page or announcement waiting for approval (Jason, 2026-11-12) — see
 * `DocumentReview.tsx`. A `ui` field stores nothing. Shown to the district only, while the
 * document is `submitted`; the component checks both again on the server.
 */
export const documentReviewField: UIField = {
  name: 'documentReview',
  type: 'ui',
  admin: {
    condition: (data, _siblingData, { user }) =>
      isDistrictAdmin(user as AuthUser | null) &&
      (data as { reviewState?: unknown } | undefined)?.reviewState === 'submitted',
    components: { Field: '/admin/Approvals/DocumentReview#DocumentReview' },
  },
}

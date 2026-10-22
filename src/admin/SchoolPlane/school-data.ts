import type { PayloadRequest } from 'payload'

import { tenantIdsFor } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

/**
 * Server-side reads for the school plane's views.
 *
 * Every read runs AS THE USER (`overrideAccess: false`, `req` carrying them), so the tenant
 * isolation the access functions enforce is the isolation these lists get — a school manager's
 * landing view cannot show another school's pages because the query that builds it cannot
 * return them. Nothing here filters by tenant itself; that would be a second, weaker copy of
 * the rule.
 *
 * `draft: true` so a title being edited shows as the user last typed it.
 */

export type SchoolPageRow = {
  id: number | string
  title: string
  reviewState: string | null
  updatedAt: string
}

const toRow = (doc: Record<string, unknown>): SchoolPageRow => ({
  id: doc.id as number | string,
  title: typeof doc.title === 'string' && doc.title !== '' ? doc.title : 'Untitled page',
  reviewState: typeof doc.reviewState === 'string' ? doc.reviewState : null,
  updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : '',
})

/** Every page the user may edit, by title. */
export const listSchoolPages = async (req: PayloadRequest): Promise<SchoolPageRow[]> => {
  const result = await req.payload.find({
    collection: 'pages',
    req,
    user: req.user,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 200,
    sort: 'title',
    select: { title: true, reviewState: true, updatedAt: true },
  })
  return result.docs.map((doc) => toRow(doc as unknown as Record<string, unknown>))
}

/**
 * The user's own pending submissions — sent, or sent back — most recently changed first.
 *
 * "Your recent submissions" in `04` §2.2 also lists *Published*. An approve clears the
 * submitter along with the rest of the review state (`review-state.ts`), so which published
 * pages were this user's is only recoverable from the audit trail, which is a later Phase 4
 * slice. Until then this lists what is still waiting.
 */
export const listMySubmissions = async (req: PayloadRequest): Promise<SchoolPageRow[]> => {
  if (!req.user) return []
  const result = await req.payload.find({
    collection: 'pages',
    req,
    user: req.user,
    overrideAccess: false,
    draft: true,
    depth: 0,
    limit: 20,
    sort: '-updatedAt',
    where: {
      and: [
        { submittedBy: { equals: req.user.id } },
        { reviewState: { in: ['submitted', 'changes-requested'] } },
      ],
    },
    select: { title: true, reviewState: true, updatedAt: true },
  })
  return result.docs.map((doc) => toRow(doc as unknown as Record<string, unknown>))
}

export type SchoolOption = { id: number | string; name: string }

/** The schools the user is assigned to, with their names, for the new-page form. */
export const listMySchools = async (req: PayloadRequest): Promise<SchoolOption[]> => {
  const ids = tenantIdsFor(req.user as AuthUser | null)
  if (ids.length === 0) return []
  const result = await req.payload.find({
    collection: 'tenants',
    req,
    overrideAccess: true,
    depth: 0,
    limit: ids.length,
    sort: 'name',
    where: { id: { in: ids } },
    select: { name: true },
  })
  return result.docs.map((doc) => ({
    id: doc.id,
    name: typeof doc.name === 'string' ? doc.name : String(doc.id),
  }))
}

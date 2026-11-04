import type { Payload, PayloadRequest } from 'payload'

import { relationshipIdOf, tenantIdsFor } from '@/access/predicates'
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
  collection: 'pages' | 'posts'
  title: string
  reviewState: string | null
  updatedAt: string
  /** A linked page (Jason, 2026-10-29) — "Update a page" marks it. */
  linked: boolean
}

const toRow = (
  doc: Record<string, unknown>,
  collection: 'pages' | 'posts' = 'pages',
): SchoolPageRow => ({
  id: doc.id as number | string,
  collection,
  title:
    typeof doc.title === 'string' && doc.title !== ''
      ? doc.title
      : collection === 'posts'
        ? 'Untitled announcement'
        : 'Untitled page',
  reviewState: typeof doc.reviewState === 'string' ? doc.reviewState : null,
  updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : '',
  linked: doc.linkMode === 'redirect' || doc.linkMode === 'reuse',
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
    select: { title: true, reviewState: true, updatedAt: true, linkMode: true },
  })
  return result.docs.map((doc) => toRow(doc as unknown as Record<string, unknown>))
}

/**
 * The user's own pending submissions — pages and announcements, sent or sent back — most
 * recently changed first.
 *
 * "Your recent submissions" in `04` §2.2 also lists *Published*. An approve clears the
 * submitter along with the rest of the review state (`review-state.ts`); the audit trail now
 * holds who sent what, and reading it here is still to come. Until then this lists what is
 * still waiting.
 */
export const listMySubmissions = async (req: PayloadRequest): Promise<SchoolPageRow[]> => {
  if (!req.user) return []
  const mine = async (collection: 'pages' | 'posts') => {
    const result = await req.payload.find({
      collection,
      req,
      user: req.user,
      overrideAccess: false,
      draft: true,
      depth: 0,
      limit: 20,
      sort: '-updatedAt',
      where: {
        and: [
          { submittedBy: { equals: req.user!.id } },
          // Posts also show one approved for later (Jason, 2026-11-04). Pages have no such state,
          // and naming one their column does not hold would be a database error.
          {
            reviewState: {
              in:
                collection === 'posts'
                  ? ['submitted', 'changes-requested', 'scheduled']
                  : ['submitted', 'changes-requested'],
            },
          },
        ],
      },
      select: { title: true, reviewState: true, updatedAt: true },
    })
    return result.docs.map((doc) => toRow(doc as unknown as Record<string, unknown>, collection))
  }
  const rows = [...(await mine('pages')), ...(await mine('posts'))]
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20)
}

export type SchoolOption = { id: number | string; name: string }

/**
 * The schools a user is assigned to, with their names — for the new-page form, and for the
 * school name the menu and account page show in place of a tenant picker. Takes `payload` and
 * the user rather than `req`, because admin slot components are handed those, not a request.
 */
export const schoolsOf = async (
  payload: Payload,
  user: AuthUser | null | undefined,
): Promise<SchoolOption[]> => {
  const ids = tenantIdsFor(user)
  if (ids.length === 0) return []
  const result = await payload.find({
    collection: 'tenants',
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

/** The schools the user is assigned to, with their names, for the new-page form. */
export const listMySchools = (req: PayloadRequest): Promise<SchoolOption[]> =>
  schoolsOf(req.payload, req.user as AuthUser | null)

export type BoardOption = { id: number | string; tenant: number | string; label: string }

/**
 * One board, for the headline on the announcements screen — read AS THE USER, so a board they may
 * not see is no board at all. Labelled "Site · Folder → Board", as on district pickers.
 */
export const boardById = async (
  payload: Payload,
  user: unknown,
  id: string,
): Promise<BoardOption | null> => {
  if (!user) return null
  const { docs } = await payload.find({
    collection: 'post-boards',
    user: user as AuthUser,
    overrideAccess: false,
    depth: 0,
    limit: 1,
    where: { id: { equals: id } },
    select: { label: true, title: true, name: true, tenant: true },
  })
  const doc = docs[0]
  if (!doc) return null
  const tenant = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
  if (tenant === null) return null
  const label =
    [doc.label, doc.title, doc.name].find((v): v is string => typeof v === 'string' && v !== '') ??
    String(doc.id)
  return { id: doc.id, tenant: Number.isNaN(Number(tenant)) ? tenant : Number(tenant), label }
}

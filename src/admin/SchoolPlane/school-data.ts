import type { Payload, PayloadRequest } from 'payload'

import { relationshipIdOf, tenantIdsFor } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import type { FolderOption } from './upload-file'

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
  collection: 'pages' | 'posts' | 'events'
  title: string
  reviewState: string | null
  updatedAt: string
  /** A linked page (Jason, 2026-10-29) — "Update a page" marks it. */
  linked: boolean
}

const toRow = (
  doc: Record<string, unknown>,
  collection: 'pages' | 'posts' | 'events' = 'pages',
): SchoolPageRow => ({
  id: doc.id as number | string,
  collection,
  title:
    typeof doc.title === 'string' && doc.title !== ''
      ? doc.title
      : collection === 'posts'
        ? 'Untitled announcement'
        : collection === 'events'
          ? 'Untitled event'
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
 * The user's own pending submissions — pages and announcements, sent or sent back. Not events:
 * they skip approval (Jason, 2026-11-11), so one is never pending — most
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
          // And one approved for later (Jason, 2026-11-04).
          { reviewState: { in: ['submitted', 'changes-requested', 'scheduled'] } },
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

export type CalendarOption = { id: number | string; tenant: number | string; label: string }

/**
 * The calendars the user may add events to — their schools' — read AS THE USER, so the list is
 * what access allows and nothing more (Jason, 2026-11-11). Labelled "Site · Calendar" when the
 * user has several schools, so two schools' calendars of the same name are told apart.
 */
export const listMyCalendars = async (req: PayloadRequest): Promise<CalendarOption[]> => {
  if (!req.user) return []
  const { docs } = await req.payload.find({
    collection: 'calendars',
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    pagination: false,
    sort: 'label',
    select: { label: true, name: true, tenant: true },
  })
  const schools = new Set(
    docs.map((d) => relationshipIdOf((d as { tenant?: unknown }).tenant as never)),
  )
  return docs.flatMap((doc) => {
    const tenant = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
    if (tenant === null) return []
    const name = typeof doc.name === 'string' && doc.name !== '' ? doc.name : String(doc.id)
    const label =
      schools.size > 1 && typeof doc.label === 'string' && doc.label !== '' ? doc.label : name
    return [{ id: doc.id, tenant: Number.isNaN(Number(tenant)) ? tenant : Number(tenant), label }]
  })
}

/**
 * The folders the user may upload into — their schools' — read AS THE USER, so the list is what
 * access allows (Jason, 2026-11-13). Each labelled with its path ("Forms › Enrollment").
 */
export const listMyFolders = async (req: PayloadRequest): Promise<FolderOption[]> => {
  if (!req.user) return []
  const { docs } = await req.payload.find({
    collection: 'resource-folders',
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    pagination: false,
    sort: 'label',
    select: { label: true, name: true, tenant: true },
  })
  return docs.flatMap((doc) => {
    const tenant = relationshipIdOf((doc as { tenant?: unknown }).tenant as never)
    if (tenant === null) return []
    const label =
      typeof doc.label === 'string' && doc.label !== ''
        ? doc.label
        : typeof doc.name === 'string'
          ? doc.name
          : String(doc.id)
    return [{ id: doc.id, tenant: Number.isNaN(Number(tenant)) ? tenant : Number(tenant), label }]
  })
}

/** A file of the user's schools, as "Replace a file" shows it (Jason, 2026-11-16). */
export type MyFile = {
  id: number | string
  title: string
  kind: 'image' | 'document'
  mimeType: string
  filesize: number | null
  url: string | null
  /** The smallest size, for an image's preview. */
  thumbnail: string | null
  alt: string
  isDecorative: boolean
  folder: string | null
}

const toMyFile = (doc: Record<string, unknown>, folders: Map<string, string>): MyFile | null => {
  const kind = doc.kind === 'image' || doc.kind === 'document' ? doc.kind : null
  if (kind === null) return null
  const folder = relationshipIdOf(doc.folder as never)
  const sizes = (doc.sizes ?? {}) as { thumbnail?: { url?: unknown } }
  return {
    id: doc.id as number | string,
    title:
      typeof doc.title === 'string' && doc.title !== '' ? doc.title : String(doc.filename ?? ''),
    kind,
    mimeType: String(doc.mimeType ?? ''),
    filesize: typeof doc.filesize === 'number' ? doc.filesize : null,
    url: typeof doc.url === 'string' ? doc.url : null,
    thumbnail: typeof sizes.thumbnail?.url === 'string' ? sizes.thumbnail.url : null,
    alt: typeof doc.alt === 'string' ? doc.alt : '',
    isDecorative: doc.isDecorative === true,
    folder: folder === null ? null : (folders.get(folder) ?? null),
  }
}

/**
 * The files of the user's schools, by title — read AS THE USER, so a school sees its own and
 * nothing else (`src/access/resources.ts`). For "Replace a file".
 */
export const listMyFiles = async (req: PayloadRequest): Promise<MyFile[]> => {
  if (!req.user) return []
  const [{ docs }, folders] = await Promise.all([
    req.payload.find({
      collection: 'resources',
      req,
      user: req.user,
      overrideAccess: false,
      depth: 0,
      pagination: false,
      sort: 'title',
    }),
    listMyFolders(req),
  ])
  const labels = new Map(folders.map((f) => [String(f.id), f.label]))
  return docs
    .map((doc) => toMyFile(doc as unknown as Record<string, unknown>, labels))
    .filter((f): f is MyFile => f !== null)
}

/** One file of the user's schools, or null — another school's is null too, as unknown. */
export const getMyFile = async (req: PayloadRequest, id: string): Promise<MyFile | null> => {
  if (!req.user || !/^\d+$/.test(id)) return null
  const doc = await req.payload.findByID({
    collection: 'resources',
    id,
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    disableErrors: true,
  })
  if (!doc) return null
  const folders = await listMyFolders(req)
  return toMyFile(
    doc as unknown as Record<string, unknown>,
    new Map(folders.map((f) => [String(f.id), f.label])),
  )
}

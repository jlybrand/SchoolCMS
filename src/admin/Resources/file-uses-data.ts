import type { PayloadRequest } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { findFileUses, type FileUses } from '@/lib/file-uses'
import { kindOf } from '@/lib/resources'

/**
 * The queries behind "Where it's used" (Jason, 2026-11-17); the rule is `findFileUses`
 * (`src/lib/file-uses.ts`, pure).
 *
 * The FILE is read AS THE USER, so asking about a file you can't see — another school's —
 * returns null, as unknown. Only then are the uses read with access overridden, because they're
 * the platform's own bookkeeping and a school's own pages are the only ones that can use a school
 * file. Every read is SCOPED TO THE FILE'S OWN SITE, except the pages that reuse one of its pages,
 * which can only be a district page's. PUBLISHED ONLY (Jason): `_status: published` on every read,
 * which the main tables hold; a newer draft lives in the versions table and is not read here.
 */
export const getFileUses = async (
  req: PayloadRequest,
  id: string | number,
): Promise<FileUses | null> => {
  if (!req.user || !/^\d+$/.test(String(id))) return null
  const file = await req.payload.findByID({
    collection: 'resources',
    id,
    req,
    user: req.user,
    overrideAccess: false,
    depth: 0,
    disableErrors: true,
  })
  if (!file) return null
  const tenant = relationshipIdOf(file.tenant as never)
  if (tenant === null) return null

  const published = { _status: { equals: 'published' } }
  const [pages, posts, tenants] = await Promise.all([
    req.payload.find({
      collection: 'pages',
      req,
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { and: [{ tenant: { equals: tenant } }, published] },
      select: { title: true, slug: true, parent: true, visibility: true, layout: true },
    }),
    req.payload.find({
      collection: 'posts',
      req,
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: {
        and: [{ tenant: { equals: tenant } }, { heroImage: { equals: file.id } }, published],
      },
      select: { title: true, tenant: true, syndication: true },
    }),
    req.payload.find({
      collection: 'tenants',
      req,
      overrideAccess: true,
      depth: 0,
      pagination: false,
      select: { name: true },
    }),
  ])

  const input = {
    file: {
      id: file.id,
      tenant,
      kind: kindOf(file.mimeType ?? undefined),
      folder: file.folder ?? null,
    },
    pages: pages.docs,
    posts: posts.docs,
    reusers: [] as { id: number | string; title?: unknown; tenant?: unknown }[],
    siteNames: new Map(
      tenants.docs.map((t) => [String(t.id), typeof t.name === 'string' ? t.name : String(t.id)]),
    ),
    allTenantIds: tenants.docs.map((t) => String(t.id)),
  }

  // A district page's content can be shown on another site; those pages reuse it.
  const first = findFileUses(input)
  if (first.pages.length === 0) return first
  const reusers = await req.payload.find({
    collection: 'pages',
    req,
    overrideAccess: true,
    depth: 0,
    pagination: false,
    where: {
      and: [
        { linkMode: { equals: 'reuse' } },
        { districtLinkTarget: { in: first.pages.map((p) => p.id) } },
        { tenant: { not_equals: tenant } },
        published,
      ],
    },
    select: { title: true, tenant: true, districtLinkTarget: true },
  })
  return findFileUses({ ...input, reusers: reusers.docs })
}

import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'

import type { AuthUser } from '@/access/types'
import { schoolListReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import { boardTitle } from '@/collections/hooks/post-hooks'

/**
 * `post-folders` — how a site's announcement boards are grouped (Jason, 2026-10-28): e.g.
 * SHS → Athletics → Football. A site may have several. Tenant-scoped through the multi-tenant
 * plugin; the district makes and names them. A school manager reads their own site's, because
 * the board they pick when posting is named by its folder.
 *
 * No drafts: nobody who can edit this needs approval. Not test-first (CLAUDE.md's exception
 * table); the access and the board title are.
 */

/** Renaming a folder renames every board in it, wherever boards are picked or shown. */
const retitleBoards: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  if (previousDoc?.name === doc.name) return doc
  const { docs: boards } = await req.payload.find({
    collection: 'post-boards',
    where: { folder: { equals: doc.id } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  for (const board of boards) {
    await req.payload.update({
      collection: 'post-boards',
      id: board.id,
      data: { title: boardTitle(doc.name, board.name) },
      overrideAccess: true,
      req,
    })
  }
  return doc
}

export const PostFolders: CollectionConfig = {
  slug: 'post-folders',
  labels: { singular: 'Folder', plural: 'Announcement folders' },
  graphQL: { singularName: 'PostFolder', pluralName: 'PostFolders' },
  admin: {
    useAsTitle: 'name',
    group: 'Content',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: schoolListReadAccess,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  hooks: { afterChange: [retitleBoards] },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'What this group of boards is called, e.g. "Athletics".' },
    },
  ],
}

import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { schoolListReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { boardTitle } from '@/collections/hooks/post-hooks'

/**
 * `post-boards` — where an announcement is filed (Jason, 2026-10-28): one board per post, each
 * board in one of its site's folders. The district makes them; a school manager picks one when
 * posting ("Which board is this for?"). A feed narrows by boards (`feedConstraint`); a board
 * never widens who sees a post — that is the post's own sharing.
 *
 * `title` is "Folder → Board", kept by these hooks and by `PostFolders`, so every picker and the
 * approval diff name a board unambiguously.
 */

/** The folder is this site's, and the title follows it. */
const placeInFolder: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const folderId = relationshipIdOf((data.folder ?? originalDoc?.folder) as never)
  const tenant = relationshipIdOf((data.tenant ?? originalDoc?.tenant) as never)
  const folder =
    folderId === null
      ? null
      : await req.payload.findByID({
          collection: 'post-folders',
          id: folderId,
          depth: 0,
          overrideAccess: true,
          disableErrors: true,
          req,
        })
  if (!folder || relationshipIdOf((folder as { tenant?: unknown }).tenant as never) !== tenant) {
    throw new ValidationError({
      errors: [{ path: 'folder', message: 'Choose one of this site’s folders.' }],
    })
  }
  return {
    ...data,
    title: boardTitle((folder as { name?: unknown }).name, data.name ?? originalDoc?.name),
  }
}

export const PostBoards: CollectionConfig = {
  slug: 'post-boards',
  labels: { singular: 'Board', plural: 'Announcement boards' },
  graphQL: { singularName: 'PostBoard', pluralName: 'PostBoards' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'tenant'],
    group: 'Content',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: schoolListReadAccess,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  hooks: { beforeChange: [placeInFolder] },
  fields: [
    {
      name: 'folder',
      type: 'relationship',
      relationTo: 'post-folders',
      required: true,
      // The site's own folders only — the hook refuses the rest.
      filterOptions: ({ data }) => {
        const tenant = (data as { tenant?: unknown } | undefined)?.tenant
        return tenant === undefined || tenant === null ? true : { tenant: { equals: tenant } }
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'What this board is called inside its folder, e.g. "News".' },
    },
    {
      name: 'title',
      type: 'text',
      admin: { hidden: true },
    },
  ],
}

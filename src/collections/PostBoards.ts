import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { schoolListReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'
import { boardLabel, boardTitle } from '@/collections/hooks/post-hooks'

/**
 * `post-boards` — where an announcement is filed (Jason, 2026-10-28): one board per post, each
 * board in one of its site's folders. The district makes them; a school manager picks one when
 * posting ("Which board is this for?"). A feed narrows by boards (`feedConstraint`); a board
 * never widens who sees a post — that is the post's own sharing.
 *
 * `title` is "Folder → Board" (a school's picker, the approval diff) and `label` is
 * "Site · Folder → Board" (the district's), both kept by these hooks and by `PostFolders`.
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
  const title = boardTitle((folder as { name?: unknown }).name, data.name ?? originalDoc?.name)
  const site = await req.payload.findByID({
    collection: 'tenants',
    id: tenant!,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  return { ...data, title, label: boardLabel((site as { name?: unknown } | null)?.name, title) }
}

export const PostBoards: CollectionConfig = {
  slug: 'post-boards',
  labels: { singular: 'Board', plural: 'Announcement boards' },
  graphQL: { singularName: 'PostBoard', pluralName: 'PostBoards' },
  admin: {
    /**
     * "Site · Folder → Board": the district picks boards for a feed across every site, where
     * "Athletics → Scores" alone could be any of 28. Schools see `title`, which is their own.
     * A renamed SITE is not carried into existing labels until each board is saved again.
     */
    useAsTitle: 'label',
    defaultColumns: ['label'],
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
    { name: 'title', type: 'text', admin: { hidden: true } },
    { name: 'label', type: 'text', admin: { hidden: true } },
  ],
}

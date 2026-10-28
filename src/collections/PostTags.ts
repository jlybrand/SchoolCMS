import type { CollectionConfig } from 'payload'

import { staffReadAccess } from '@/access/post-structure'
import { isDistrictAdmin } from '@/access/predicates'
import { districtOnly } from '@/access/tenant-scoped'
import type { AuthUser } from '@/access/types'

/**
 * `post-tags` — ONE district-wide list (Jason, 2026-10-28), e.g. "High", "SHS", "Athletics".
 * Posters tick from it; a feed narrows by any of them. Kept by the district, never typed freely
 * on a post: "High", "high school" and "HS" would be three tags and a feed filter would miss
 * two of them.
 *
 * Not tenant-scoped. Replaces the open `category` question in `03` §2.
 */
export const PostTags: CollectionConfig = {
  slug: 'post-tags',
  labels: { singular: 'Tag', plural: 'Announcement tags' },
  graphQL: { singularName: 'PostTag', pluralName: 'PostTags' },
  admin: {
    useAsTitle: 'name',
    group: 'Content',
    hidden: ({ user }) => !isDistrictAdmin(user as AuthUser | null),
  },
  access: {
    read: staffReadAccess,
    create: districtOnly,
    update: districtOnly,
    delete: districtOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: 'One word or two, as it should read on every school’s list.' },
    },
  ],
}

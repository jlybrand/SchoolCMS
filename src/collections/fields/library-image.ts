/**
 * An image from the site's own library (Jason, 2026-11-13) — the file a page section or an
 * announcement shows, chosen from THIS site's images. Its alt text is the library's, never
 * re-entered here, so rule 7 holds at upload.
 *
 * Used by the Image and Hero blocks (`src/collections/blocks`) and by an announcement's
 * `heroImage` (`src/collections/Posts.ts`).
 */
export const libraryImageField = ({
  name = 'image',
  label = 'Image',
  required = true,
  description,
}: {
  name?: string
  label?: string
  required?: boolean
  description: string
}) =>
  ({
    name,
    type: 'upload',
    relationTo: 'resources',
    required,
    label,
    // This site's images only. Payload checks it on save too, not only in the picker.
    filterOptions: ({ data }: { data?: { tenant?: unknown } }) => {
      const tenant = data?.tenant
      const image = { kind: { equals: 'image' } }
      return tenant === undefined || tenant === null
        ? image
        : { and: [image, { tenant: { equals: tenant } }] }
    },
    admin: {
      description,
      // Files are uploaded in the library ("Upload a file"), not made here.
      allowCreate: false,
    },
  }) as const

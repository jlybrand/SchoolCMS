import { ValidationError, type CollectionBeforeValidateHook } from 'payload'

import { tenantIdOf } from '@/access/predicates'

/**
 * An image in the WORDS comes from this site's library only (Jason, 2026-11-19) — as the Image
 * section's does, where the tenant plugin refuses another site's file on save. The editor only
 * offers this site's library; this is the same rule for the API, which Payload's upload node does
 * not check on its own (`tests/integration/rich-text-images.test.ts`).
 *
 * Finds every library image (`upload` → `resources`) in any rich text on the document — a page's
 * sections, a post's body, an event's notes — and refuses the save, on the field that holds it,
 * when one belongs to another site, or is not an image (the library holds documents too, which
 * would render as nothing). A file that no longer exists is left to render nothing.
 */
type Found = { field: string; id: string }

const collect = (value: unknown, path: string[], field: string | null, out: Found[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collect(item, [...path, String(i)], field, out))
    return
  }
  if (typeof value !== 'object' || value === null) return
  const node = value as Record<string, unknown>
  // A Lexical state: everything under it belongs to the field at `path`.
  const here = field ?? ('root' in node ? path.join('.') : null)
  if (here !== null && node.type === 'upload' && node.relationTo === 'resources') {
    const ref = node.value
    const id =
      typeof ref === 'object' && ref !== null ? (ref as { id?: unknown }).id : (ref as unknown)
    if (typeof id === 'number' || typeof id === 'string') out.push({ field: here, id: String(id) })
  }
  for (const [key, child] of Object.entries(node)) collect(child, [...path, key], here, out)
}

export const textImagesAreThisSites: CollectionBeforeValidateHook = async ({
  data,
  originalDoc,
  req,
}) => {
  if (!data) return data
  const found: Found[] = []
  collect(data, [], null, found)
  if (found.length === 0) return data

  const tenant = tenantIdOf(
    ((data as { tenant?: unknown }).tenant ??
      (originalDoc as { tenant?: unknown } | undefined)?.tenant) as never,
  )
  const { docs } = await req.payload.find({
    collection: 'resources',
    where: { id: { in: [...new Set(found.map((f) => f.id))] } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    select: { tenant: true, kind: true },
    req,
  })
  const elsewhere = new Set(
    docs
      .filter((doc) => tenantIdOf((doc as { tenant?: unknown }).tenant as never) !== tenant)
      .map((doc) => String(doc.id)),
  )
  const notImages = new Set(
    docs.filter((doc) => (doc as { kind?: unknown }).kind !== 'image').map((doc) => String(doc.id)),
  )
  const refuse = (ids: ReadonlySet<string>, message: string) => {
    const fields = [...new Set(found.filter((f) => ids.has(f.id)).map((f) => f.field))]
    if (fields.length > 0)
      throw new ValidationError({ errors: fields.map((path) => ({ path, message })) })
  }
  refuse(elsewhere, 'An image here is from another site’s library. Choose one from this site’s.')
  // The library holds documents too; one placed as an image would show nothing.
  refuse(
    notImages,
    'Only images can go in the text. To share a document, link to it, or use a Document list section.',
  )
  return data
}

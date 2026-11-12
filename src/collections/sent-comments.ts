import type { PayloadRequest } from 'payload'

/**
 * What each school wrote when it last sent a page or announcement for approval (Jason,
 * 2026-11-12): the comment on its newest `submit` entry in the activity log — empty when that
 * send had none, even if an earlier one did. Read as the platform, for the queue and the digest.
 *
 * Keyed `collection/id`.
 */
export const sentComments = async (
  req: PayloadRequest,
  items: readonly { collection: string; id: number | string }[],
): Promise<Map<string, string>> => {
  const out = new Map<string, string>()
  if (items.length === 0) return out
  const { docs } = await req.payload.find({
    collection: 'audit-events',
    where: {
      and: [
        { action: { equals: 'submit' } },
        { documentId: { in: [...new Set(items.map((i) => String(i.id)))] } },
        { contentType: { in: [...new Set(items.map((i) => i.collection))] } },
      ],
    },
    sort: '-createdAt',
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
    select: { contentType: true, documentId: true, comment: true },
  })
  for (const doc of docs as { contentType?: unknown; documentId?: unknown; comment?: unknown }[]) {
    const key = `${String(doc.contentType)}/${String(doc.documentId)}`
    // Newest first: the first seen is the latest send.
    if (!out.has(key)) out.set(key, typeof doc.comment === 'string' ? doc.comment : '')
  }
  return out
}

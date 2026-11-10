import type { Payload, PayloadRequest, Where } from 'payload'

import { composeBody, hasWords } from '@/lib/compose-page'

/**
 * Every page composed (Jason, 2026-11-04): the one-off conversion of the pages that exist.
 * Run with `pnpm run compose:pages`; safe to run again — a converted page is left alone.
 *
 * For each page: what is LIVE is republished with its words as a Text section, and a newer
 * DRAFT — a school's change waiting for approval, or a page never published — is written again
 * on top of it, converted the same way, with its review state as it was.
 *
 * WHY A MARK. Republishing is not an approval and re-saving a school's draft is not a school
 * asking for anything, but the hooks cannot tell either from the real thing. So these writes
 * carry `composingPages` in `req.context` — set by server code only, no request can — and are
 * made with NO user: `publishGate` lets a marked, user-less publish through, `applyReviewState`
 * keeps the review fields the write carries, and no outcome email is sent. The audit trail
 * records them as System.
 */

export const COMPOSING_PAGES = 'composingPages'

/** Whether this write is the conversion's own. */
export const composingPagesOf = (req: Pick<PayloadRequest, 'context'>): boolean =>
  req.context?.[COMPOSING_PAGES] === true

type Doc = Record<string, unknown>

/** Fields Payload owns, which a write must not restate. */
const OWNED = new Set(['id', 'createdAt', 'updatedAt'])

const needsComposing = (doc: Doc): boolean => doc.pageType !== 'composed' || hasWords(doc.body)

const composed = (doc: Doc): Doc => ({
  ...Object.fromEntries(Object.entries(doc).filter(([key]) => !OWNED.has(key))),
  layout: composeBody(doc.body, doc.layout).layout,
  body: null,
  pageType: 'composed',
})

export type ComposeResult = { converted: (string | number)[] }

export const composeExistingPages = async (
  payload: Payload,
  { ids }: { ids?: (string | number)[] } = {},
): Promise<ComposeResult> => {
  const where: Where | undefined = ids ? { id: { in: ids } } : undefined
  const context = { [COMPOSING_PAGES]: true }
  const converted: (string | number)[] = []

  for (let page = 1; ; page += 1) {
    const batch = await payload.find({
      collection: 'pages',
      ...(where ? { where } : {}),
      // The main table, not the versions: every page has a row there, and `id` means the page.
      depth: 0,
      limit: 100,
      page,
      sort: 'id',
      overrideAccess: true,
    })

    for (const { id } of batch.docs) {
      const read = (draft: boolean) =>
        payload.findByID({
          collection: 'pages',
          id,
          draft,
          depth: 0,
          overrideAccess: true,
        }) as unknown as Promise<Doc>
      const latest = await read(true)
      const shown = await read(false)
      const isLive = shown._status === 'published'
      const waiting = isLive && latest._status === 'draft'

      const liveNeeds = isLive && needsComposing(shown)
      if (!liveNeeds && !needsComposing(latest)) continue

      if (liveNeeds) {
        await payload.update({
          collection: 'pages',
          id,
          data: { ...composed(shown), _status: 'published' },
          draft: false,
          depth: 0,
          overrideAccess: true,
          context,
        })
      }
      /**
       * The newer draft goes back on top. After a republish it must, whether or not it needed
       * converting itself: the republish made the live version the latest, burying it.
       */
      if (
        (!isLive && needsComposing(latest)) ||
        (waiting && (liveNeeds || needsComposing(latest)))
      ) {
        await payload.update({
          collection: 'pages',
          id,
          data: { ...composed(latest), _status: 'draft' },
          draft: true,
          depth: 0,
          overrideAccess: true,
          context,
        })
      }
      converted.push(id)
    }

    if (!batch.hasNextPage) break
  }

  return { converted }
}

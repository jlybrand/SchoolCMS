import type { PayloadRequest, TextareaField } from 'payload'

/**
 * The optional comment on Publish, Schedule and Send for approval (Jason, 2026-11-12).
 *
 * VIRTUAL: never stored on the page or announcement, so it cannot ride along into the next
 * autosave or the next version. It travels WITH ONE WRITE — the publish dialog, the school's Send
 * for approval box and the queue's Approve send it as `changeComment` — and its `beforeChange`
 * hook (which Payload runs for virtual fields too) leaves it on the request, keyed to the document
 * it came with. The activity log (`auditChange`) and the outcome email read it from there; the
 * activity-log entry is where it is kept.
 */

export const CHANGE_COMMENT = 'changeComment'

type Stashed = { collection: string; id: string | null; comment: string }

const MAX = 2000

export const changeCommentField: TextareaField = {
  name: CHANGE_COMMENT,
  type: 'textarea',
  virtual: true,
  maxLength: MAX,
  admin: { hidden: true },
  hooks: {
    beforeChange: [
      ({ value, req, collection, originalDoc }) => {
        const comment = typeof value === 'string' ? value.trim().slice(0, MAX) : ''
        if (comment !== '' && collection) {
          const id = (originalDoc as { id?: unknown } | undefined)?.id
          const stashed: Stashed = {
            collection: collection.slug,
            id: typeof id === 'string' || typeof id === 'number' ? String(id) : null,
            comment,
          }
          req.context[CHANGE_COMMENT] = stashed
        }
        return undefined
      },
    ],
  },
}

/**
 * The comment sent with this write of `collection`/`id`, or undefined. Keyed, so another document
 * written in the same request (a linked page, a cascade) never picks it up; a create has no id
 * yet, so it matches on the collection alone.
 */
export const changeCommentFor = (
  req: Pick<PayloadRequest, 'context'>,
  collection: string,
  id: unknown,
): string | undefined => {
  const stashed = req.context?.[CHANGE_COMMENT] as Stashed | undefined
  if (!stashed || stashed.collection !== collection) return undefined
  if (stashed.id !== null && stashed.id !== String(id)) return undefined
  return stashed.comment
}

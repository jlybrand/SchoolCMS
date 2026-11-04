import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { autoApprovalOf } from '@/collections/hooks/auto-approve'
import { outcomeEmail, publicUrlFor, reviewOutcome } from '@/lib/review-emails'
import { buildPagePath } from '@/lib/slug'

/**
 * Emails the person who sent a page or announcement when the district approves it or sends it back
 * (`04` §4.5). Without it a school manager only learns the outcome by logging in again — and
 * they log in a few times a year (`04` §2.1).
 *
 * `afterChange`, reading the submitter from `previousDoc`: an approval clears `submittedBy`
 * along with the rest of the review state (`applyReviewState`), so the doc after the write no
 * longer says who to tell.
 *
 * Sent through Payload's own `sendEmail` (the Resend adapter in `payload.config.ts`). With no
 * API key configured, Payload logs the message instead of sending it.
 *
 * NEVER FAILS THE WRITE. An approval that succeeded is not reported as failed because an email
 * could not be sent; the error is logged.
 */

type Message = { to: string; subject: string; text: string; html: string }

export type NotifyDeps = {
  /** The collection the hook is registered on — the edit link and the email's wording. */
  collection: 'pages' | 'posts'
  send: (message: Message, req: PayloadRequest) => Promise<unknown>
  serverUrl: string
  recipientFor: (userId: string, req: PayloadRequest) => Promise<string | null>
  schoolFor: (
    tenantId: string,
    req: PayloadRequest,
  ) => Promise<{ name: string; hostname: string } | null>
  /** The public path, or null for something with no address of its own yet. */
  pathFor: (doc: Record<string, unknown>, req: PayloadRequest) => Promise<string | null>
}

export const makeNotifyReviewOutcome =
  (deps: NotifyDeps): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, req }) => {
    const outcome = reviewOutcome(previousDoc, doc)
    if (!outcome) return doc
    // Auto-approved under a grant: the sender published it, and nobody approved anything to tell
    // them about. The audit trail and the district's 30-day list still show it (`04` §4.3).
    if (autoApprovalOf(req)) return doc

    try {
      const submitter = relationshipIdOf((previousDoc?.submittedBy ?? null) as never)
      const to = submitter === null ? null : await deps.recipientFor(submitter, req)
      if (!to) {
        req.payload.logger.error(
          `notifyReviewOutcome: no email address for the sender of ${deps.collection} ${String(doc.id)}; nobody told`,
        )
        return doc
      }

      const tenant = relationshipIdOf((doc.tenant ?? null) as never)
      const school = tenant === null ? null : await deps.schoolFor(tenant, req)
      const path = await deps.pathFor(doc, req)
      const noun = deps.collection === 'posts' ? 'announcement' : 'page'
      const email = outcomeEmail({
        outcome,
        noun,
        title: typeof doc.title === 'string' ? doc.title : `Your ${noun}`,
        school: school?.name ?? 'your school',
        pageUrl:
          path === null
            ? null
            : school
              ? publicUrlFor(deps.serverUrl, school.hostname, path)
              : deps.serverUrl,
        editUrl: `${deps.serverUrl.replace(/\/$/, '')}/admin/collections/${deps.collection}/${String(doc.id)}`,
        note: typeof doc.reviewNote === 'string' ? doc.reviewNote : null,
        goesLive:
          typeof doc.publishAt === 'string' || doc.publishAt instanceof Date
            ? new Date(doc.publishAt as string).toISOString()
            : null,
      })
      await deps.send({ to, ...email }, req)
    } catch (err) {
      req.payload.logger.error(
        `notifyReviewOutcome: could not email about ${deps.collection} ${String(doc.id)}: ${(err as Error).message}`,
      )
    }
    return doc
  }

/** The submitter's address, read as the platform. */
export const userEmail: NotifyDeps['recipientFor'] = async (userId, req) => {
  const user = await req.payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  const email = (user as { email?: unknown } | null)?.email
  return typeof email === 'string' && email !== '' ? email : null
}

export const schoolOf: NotifyDeps['schoolFor'] = async (tenantId, req) => {
  const tenant = await req.payload.findByID({
    collection: 'tenants',
    id: tenantId,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  const { name, hostname } = (tenant ?? {}) as { name?: unknown; hostname?: unknown }
  return typeof hostname === 'string' && hostname !== ''
    ? { name: typeof name === 'string' ? name : hostname, hostname }
    : null
}

/** The page's public path, walking its parents. Bounded, so a cycle cannot hang a publish. */
export const pagePath: NotifyDeps['pathFor'] = async (doc, req) => {
  const segments: unknown[] = [doc.slug]
  let parent = relationshipIdOf((doc.parent ?? null) as never)
  for (let depth = 0; parent !== null && depth < 10; depth += 1) {
    const page = await req.payload.findByID({
      collection: 'pages',
      id: parent,
      depth: 0,
      overrideAccess: true,
      disableErrors: true,
      req,
    })
    if (!page) break
    segments.unshift((page as { slug?: unknown }).slug)
    parent = relationshipIdOf(((page as { parent?: unknown }).parent ?? null) as never)
  }
  return buildPagePath(segments.map((s) => (typeof s === 'string' ? s : null)))
}

export const sendWithPayload: NotifyDeps['send'] = (message, req) => req.payload.sendEmail(message)

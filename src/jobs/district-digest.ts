import type { PayloadRequest, TaskConfig } from 'payload'

import { relationshipIdOf } from '@/access/predicates'
import { sentComments } from '@/collections/sent-comments'
import { alertRecipients, districtMail, type WaitingPage } from '@/lib/district-digest'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

/**
 * The district's daily digest and overdue alert (`04` §4.5, §5), as a task on Payload's jobs
 * queue — Payload's own scheduler, not a bespoke one (CLAUDE.md).
 *
 * Scheduled HOURLY, and `districtMail` sends only inside the digest hour on a weekday, district
 * time. Payload evaluates a schedule's cron on the server's clock and takes no time zone, so a
 * "7am" cron would drift an hour at every daylight-saving change on a UTC container; deciding
 * the hour in code keeps it 7am in New York whatever the server is set to.
 *
 * A scheduled job's `waitUntil` is the hour it was scheduled for, and that is the time the task
 * decides by — not the moment a busy runner got to it.
 *
 * `retries: 0`: a retry after a partial send would mail the admins who already got it.
 * A failed send is logged and the next admin is still mailed.
 *
 * Reads as the platform (`overrideAccess`): there is no user in a scheduled job, and it mails
 * only district admins, who can see every school's queue anyway — the ones opted in to
 * `users.receivesAlerts`, or all of them if nobody is.
 */

export const DISTRICT_DIGEST_TASK = 'districtDigest'

/**
 * Every page and announcement waiting for approval, oldest first, with its school's name.
 * Two reads, merged — the queue is one queue whatever was sent.
 */
const waitingPages = async (req: PayloadRequest): Promise<WaitingPage[]> => {
  const waiting = async (collection: 'pages' | 'posts') =>
    (
      await req.payload.find({
        collection,
        where: { reviewState: { equals: 'submitted' } },
        draft: true,
        pagination: false,
        depth: 0,
        overrideAccess: true,
        req,
      })
    ).docs.map((d) => ({ ...d, kind: collection === 'posts' ? 'announcement' : 'page' }) as const)
  const docs = [...(await waiting('pages')), ...(await waiting('posts'))].sort((a, b) =>
    String(a.submittedAt ?? '').localeCompare(String(b.submittedAt ?? '')),
  )
  const tenantIds = [
    ...new Set(
      docs.map((d) => relationshipIdOf(d.tenant as never)).filter((id): id is string => !!id),
    ),
  ]
  const { docs: tenants } =
    tenantIds.length === 0
      ? { docs: [] }
      : await req.payload.find({
          collection: 'tenants',
          where: { id: { in: tenantIds } },
          pagination: false,
          depth: 0,
          overrideAccess: true,
          req,
        })
  const names = new Map(tenants.map((t) => [String(t.id), t.name]))
  const comments = await sentComments(
    req,
    docs.map((d) => ({ collection: d.kind === 'announcement' ? 'posts' : 'pages', id: d.id })),
  )
  return docs.map((d) => ({
    title: typeof d.title === 'string' ? d.title : '',
    school: names.get(relationshipIdOf(d.tenant as never) ?? '') ?? 'Unknown school',
    sentAt: d.submittedAt,
    kind: d.kind,
    comment: comments.get(`${d.kind === 'announcement' ? 'posts' : 'pages'}/${String(d.id)}`) ?? '',
  }))
}

/** The district admins who get this mail — `alertRecipients` decides, from `receivesAlerts`. */
const recipients = async (req: PayloadRequest): Promise<string[]> => {
  const { docs } = await req.payload.find({
    collection: 'users',
    where: { roles: { in: ['district-admin'] } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const { to, fallback } = alertRecipients(docs)
  if (fallback) {
    req.payload.logger.warn(
      'districtDigest: nobody is opted in to district alerts, so every district admin is mailed.',
    )
  }
  return to
}

export const runDistrictDigest = async (req: PayloadRequest, at: Date): Promise<void> => {
  const queueUrl = `${(process.env.NEXT_PUBLIC_SERVER_URL ?? '').replace(/\/$/, '')}/admin/approvals`
  const mail = districtMail({
    pages: await waitingPages(req),
    at,
    timeZone: DISTRICT_TIME_ZONE,
    queueUrl,
  })
  if (mail.length === 0) return

  // One message per admin: one bad address must not stop the rest (Resend rejects the whole
  // message), and admins are not shown each other's addresses.
  for (const to of await recipients(req)) {
    for (const email of mail) {
      try {
        await req.payload.sendEmail({ to, ...email })
      } catch (err) {
        req.payload.logger.error(
          `districtDigest: could not send "${email.subject}" to a district admin: ${(err as Error).message}`,
        )
      }
    }
  }
}

export const districtDigestTask: TaskConfig = {
  slug: DISTRICT_DIGEST_TASK,
  label: 'District digest and overdue alert',
  retries: 0,
  schedule: [{ cron: '0 * * * *', queue: 'default' }],
  handler: async ({ job, req }) => {
    const scheduled = job.waitUntil ? new Date(job.waitUntil) : null
    const at = scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : new Date()
    await runDistrictDigest(req, at)
    return { output: {} }
  },
}

import { createHmac, timingSafeEqual } from 'node:crypto'

import type { Endpoint, PayloadRequest, TaskConfig } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { latestVersion, publishable } from '@/collections/endpoints/approve'
import { SCHEDULED_RUN, type ScheduledRun } from '@/collections/hooks/scheduled-dates'
import { revalidatePost } from '@/collections/hooks/revalidate-on-publish'

/**
 * The schedule (Jason, 2026-11-04): every five minutes,
 *
 *   1. posts and pages approved or scheduled for a Start that has come go live — the version
 *      that was scheduled (a page's Start is in Page settings);
 *   2. live posts whose Expires has passed are taken off the website (unpublished, not deleted);
 *   3. posts whose Featured until has just passed have their sites refreshed, so they drop back
 *      into date order.
 *
 * WHY AN ENDPOINT. The sweep publishes through Payload, and a publish refreshes the public pages
 * with Next's `revalidatePath` — which works only inside a request (a Route Handler or Server
 * Function), not in a background job. So the task (`scheduleTask`, on Payload's own jobs queue
 * like the district digest) calls this endpoint on its own server, and the sweep runs inside that
 * request. If the call fails, the task runs the sweep itself: the content is still right, and the
 * public pages catch up on their hourly refresh.
 *
 * WHO MAY CALL IT: a district admin, or the task, with a key derived from `PAYLOAD_SECRET` — no
 * new secret to manage, and nobody without the server's secret can make it.
 */

export const SCHEDULE_TASK = 'publishSchedule'
const KEY_HEADER = 'x-dd2-schedule-key'
/** Featured posts whose time passed within this window are refreshed — two runs, overlapping. */
const FEATURE_WINDOW_MS = 10 * 60 * 1000

export const scheduleKey = (): string =>
  createHmac('sha256', process.env.PAYLOAD_SECRET ?? '')
    .update('dd2-post-schedule')
    .digest('hex')

const keyMatches = (sent: string | null): boolean => {
  if (!sent || !process.env.PAYLOAD_SECRET) return false
  const a = Buffer.from(sent)
  const b = Buffer.from(scheduleKey())
  return a.length === b.length && timingSafeEqual(a, b)
}

export type ScheduleRun = { published: string[]; expired: string[]; refreshed: string[] }

/** One marked write; the mark is the job's alone, and is gone again afterwards. */
const asTheSchedule = async <T>(
  req: PayloadRequest,
  run: ScheduledRun,
  write: () => Promise<T>,
) => {
  req.context[SCHEDULED_RUN] = run
  try {
    return await write()
  } finally {
    delete req.context[SCHEDULED_RUN]
  }
}

export const runSchedule = async (req: PayloadRequest, now: Date): Promise<ScheduleRun> => {
  const { payload } = req
  const at = now.toISOString()
  const result: ScheduleRun = { published: [], expired: [], refreshed: [] }
  const ids = async (
    collection: 'posts' | 'pages',
    where: Record<string, unknown>,
    draft: boolean,
  ) =>
    (
      await payload.find({
        collection,
        where: where as never,
        draft,
        pagination: false,
        depth: 0,
        overrideAccess: true,
        req,
        select: { tenant: true },
      })
    ).docs.map((doc) => doc.id)

  // 1. Go live. Only while still `scheduled`: a school's edit since approval drops that state, and
  //    their new words were not approved, so they wait for the queue again.
  for (const collection of ['posts', 'pages'] as const) {
    for (const id of await ids(
      collection,
      { and: [{ reviewState: { equals: 'scheduled' } }, { publishAt: { less_than_equal: at } }] },
      true,
    )) {
      try {
        const latest = await latestVersion(payload, collection, id, req)
        if (latest?.version.reviewState !== 'scheduled') continue
        await asTheSchedule(req, 'publish', () =>
          payload.update({
            collection,
            id,
            data: { ...publishable(latest.version), _status: 'published' } as never,
            draft: false,
            overrideAccess: true,
            req,
          }),
        )
        result.published.push(`${collection}/${String(id)}`)
      } catch (err) {
        payload.logger.error({ err }, `schedule: could not publish ${collection} ${String(id)}`)
      }
    }
  }

  // 2. Expire (posts only): the live record, taken down.
  for (const id of await ids(
    'posts',
    { and: [{ _status: { equals: 'published' } }, { expiresAt: { less_than_equal: at } }] },
    false,
  )) {
    try {
      await asTheSchedule(req, 'expire', () =>
        payload.update({
          collection: 'posts',
          id,
          data: { _status: 'draft' } as never,
          draft: false,
          overrideAccess: true,
          req,
        }),
      )
      result.expired.push(`posts/${String(id)}`)
    } catch (err) {
      payload.logger.error({ err }, `schedule: could not expire post ${String(id)}`)
    }
  }

  // 3. No longer featured: nothing is written, so the sites are refreshed directly.
  const since = new Date(now.getTime() - FEATURE_WINDOW_MS).toISOString()
  const { docs: ended } = await payload.find({
    collection: 'posts',
    where: {
      and: [
        { _status: { equals: 'published' } },
        { featuredUntil: { greater_than: since } },
        { featuredUntil: { less_than_equal: at } },
      ],
    },
    pagination: false,
    depth: 0,
    overrideAccess: true,
    req,
  })
  for (const doc of ended) {
    await revalidatePost({ doc, previousDoc: doc, req } as never)
    result.refreshed.push(`posts/${String(doc.id)}`)
  }

  return result
}

/** `POST /api/schedule/run` — the sweep, inside a request. A root endpoint: it serves both. */
export const scheduleEndpoint: Endpoint = {
  path: '/schedule/run',
  method: 'post',
  handler: async (req) => {
    const allowed =
      isDistrictAdmin(req.user as AuthUser | null) || keyMatches(req.headers.get(KEY_HEADER))
    if (!allowed) return Response.json({ error: 'Not allowed.' }, { status: 403 })
    return Response.json(await runSchedule(req, new Date()))
  },
}

/** This server, as the task reaches it — the same process, so plain HTTP on its own port. */
const ownServer = (): string =>
  (process.env.DD2_INTERNAL_URL ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`).replace(
    /\/$/,
    '',
  )

export const scheduleTask: TaskConfig = {
  slug: SCHEDULE_TASK,
  // A retry would only repeat a sweep the next run makes anyway.
  retries: 0,
  schedule: [{ cron: '*/5 * * * *', queue: 'default' }],
  handler: async ({ req }) => {
    try {
      const res = await fetch(`${ownServer()}/api/schedule/run`, {
        method: 'POST',
        headers: { [KEY_HEADER]: scheduleKey() },
      })
      if (res.ok) return { output: {} }
      req.payload.logger.warn(`schedule: endpoint answered ${res.status}; sweeping in-process`)
    } catch (err) {
      req.payload.logger.warn({ err }, 'schedule: endpoint unreachable; sweeping in-process')
    }
    // Content is still right; the public pages catch up on their hourly refresh.
    await runSchedule(req, new Date())
    return { output: {} }
  },
}

import type { Endpoint, TaskConfig } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { revalidateAllSites } from '@/collections/hooks/revalidate-on-publish'
import { staffSourceFromEnv } from '@/sync/csi-mock'
import { runStaffSync } from '@/sync/staff-sync'

/**
 * The CSI staff sync, run (Jason, 2026-11-13; `11` §6): NIGHTLY on Payload's jobs queue, and
 * "Sync now" for the district. Off the public request path entirely. With no source set up
 * (`CSI_SOURCE`), both do nothing and say so — the directory keeps what it has.
 *
 * "Sync now" refreshes the sites' staff lists at once. The nightly run is outside a request,
 * where Next cannot revalidate (`schedule.ts` explains): its changes show on the pages' hourly
 * refresh.
 */

export const STAFF_SYNC_TASK = 'csiStaffSync'
const NO_SOURCE = 'No CSI connection is set up yet.'

/** `POST /api/staff-sync/run` — the district's "Sync now". */
export const staffSyncEndpoint: Endpoint = {
  path: '/staff-sync/run',
  method: 'post',
  handler: async (req) => {
    if (!isDistrictAdmin(req.user as AuthUser | null)) {
      return Response.json({ error: 'Not allowed.' }, { status: 403 })
    }
    const source = staffSourceFromEnv()
    if (!source) return Response.json({ ok: false, reason: NO_SOURCE }, { status: 409 })
    const summary = await runStaffSync(req.payload, source, new Date())
    // Inside a request, so the staff lists on every site can be refreshed now — once.
    if (
      summary.ok &&
      summary.created + summary.updated + summary.hidden + summary.schoolsRenamed > 0
    ) {
      await revalidateAllSites(req, 'staff sync')
    }
    return Response.json(summary, { status: summary.ok ? 200 : 409 })
  },
}

export const staffSyncTask: TaskConfig = {
  slug: STAFF_SYNC_TASK,
  // Tomorrow night's run is the retry; a failed run has changed nothing (last-known-good).
  retries: 0,
  schedule: [{ cron: '0 2 * * *', queue: 'default' }],
  handler: async ({ req }) => {
    const source = staffSourceFromEnv()
    if (!source) {
      req.payload.logger.info(`staff sync: ${NO_SOURCE} Skipped.`)
      return { output: {} }
    }
    await runStaffSync(req.payload, source, new Date())
    return { output: {} }
  },
}

import Link from 'next/link'
import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { countWaiting } from './queue-data'
import styles from './Approvals.module.css'

/**
 * At the top of the district's dashboard (`admin.components.beforeDashboard`): how many
 * submissions
 * are waiting, and the way in. The queue is the district's daily work (`04` §3.1), so it is the
 * first thing on their home screen rather than something they have to remember to visit.
 *
 * Renders nothing for anyone else — school managers never see Payload's dashboard at all.
 */
export const WaitingBanner = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  if (!isDistrictAdmin(user as AuthUser | null)) return null
  const waiting = await countWaiting(payload, user)

  return (
    <div className={styles.banner} id="waiting-banner">
      <p className={styles.bannerText}>
        {waiting === 0
          ? 'Nothing is waiting for approval.'
          : `${waiting} ${waiting === 1 ? 'submission is' : 'submissions are'} waiting for approval.`}
      </p>
      <Link className={styles.bannerLink} href="/admin/approvals">
        Open the approval queue
      </Link>
    </div>
  )
}

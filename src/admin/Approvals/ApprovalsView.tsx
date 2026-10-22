import { Gutter } from '@payloadcms/ui'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { ApprovalItem } from './ApprovalItem'
import { loadQueue } from './queue-data'
import styles from './Approvals.module.css'

/**
 * The approval queue (`04` §4.2) at `/admin/approvals` — every school's waiting pages, oldest
 * first, each with its diff and a one-click approve.
 *
 * District only. A school manager is sent to their own home screen; the approve endpoint
 * refuses them independently, so this redirect is navigation, not the guarantee.
 */
export const ApprovalsView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!isDistrictAdmin(req.user as AuthUser | null)) redirect('/admin')

  const items = await loadQueue(req)

  return (
    <Gutter>
      <div className={styles.view} id="approvals">
        <h1 className={styles.title}>Waiting for approval</h1>
        <p className={styles.summary} role="status">
          {items.length === 0
            ? 'Nothing is waiting. Every school’s changes have been dealt with.'
            : `${items.length} ${items.length === 1 ? 'page is' : 'pages are'} waiting, oldest first.`}
        </p>
        <div className={styles.items}>
          {items.map((item) => (
            <ApprovalItem item={item} key={String(item.id)} />
          ))}
        </div>
      </div>
    </Gutter>
  )
}

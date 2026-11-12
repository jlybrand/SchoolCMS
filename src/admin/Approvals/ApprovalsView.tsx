import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { ApprovalItem } from './ApprovalItem'
import { loadQueue } from './queue-data'
import { filterQueue, kindWords, queueKindFrom, queueSummary } from './queue-filter'
import styles from './Approvals.module.css'

/**
 * The approval queue (`04` §4.2) at `/admin/approvals` — every school's waiting pages and
 * announcements, oldest
 * first, each with its diff and a one-click approve.
 *
 * `?kind=pages` or `?kind=posts` narrows it to one kind — what the dashboard's cards open (Jason,
 * 2026-11-12) — with a way back to everything.
 *
 * District only. A school manager is sent to their own home screen; the approve endpoint
 * refuses them independently, so this redirect is navigation, not the guarantee.
 */
export const ApprovalsView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!isDistrictAdmin(req.user as AuthUser | null)) redirect('/admin')

  const kind = queueKindFrom(searchParams)
  const items = filterQueue(await loadQueue(req), kind)

  return (
    <Gutter>
      <div className={styles.view} id="approvals">
        <h1 className={styles.title}>Waiting for approval</h1>
        <p className={styles.summary} role="status">
          {queueSummary(items.length, kind)}
        </p>
        {kind !== null ? (
          <p className={styles.filter}>
            Showing {kindWords(kind).many} only.{' '}
            <Link href="/admin/approvals">Show everything waiting</Link>
          </p>
        ) : null}
        <div className={styles.items}>
          {items.map((item) => (
            <ApprovalItem item={item} key={`${item.collection}-${String(item.id)}`} />
          ))}
        </div>
      </div>
    </Gutter>
  )
}

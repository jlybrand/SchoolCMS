import Link from 'next/link'
import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { findGrantHolders } from './grant-data'
import { grantRows } from './grants'
import styles from './Grants.module.css'

/**
 * On the district's dashboard (`admin.components.beforeDashboard`, after the waiting banner):
 * who currently holds an auto-approval grant (`04` §4.3). Visible so a grant someone else made
 * is not forgotten; each name links to the user, where it is revoked.
 *
 * Renders nothing for anyone else — school managers never see Payload's dashboard at all.
 */
export const GrantsPanel = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  if (!isDistrictAdmin(user as AuthUser | null)) return null

  const rows = grantRows(await findGrantHolders(payload, user))

  return (
    <section aria-labelledby="grants-heading" className={styles.panel} id="grants-panel">
      <h2 className={styles.heading} id="grants-heading">
        Auto-approval grants
      </h2>
      {rows.length === 0 ? (
        <p className={styles.muted}>Nobody holds a grant. Every change waits for approval.</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.userId}>
              <Link href={`/admin/collections/users/${row.userId}`}>{row.person}</Link>:{' '}
              {row.grants.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

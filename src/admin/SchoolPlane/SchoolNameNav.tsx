import type { Payload, PayloadRequest } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { schoolsOf } from './school-data'
import { schoolNamesLabel } from './school-plane'
import styles from './SchoolPlane.module.css'

/**
 * The school a manager works on, at the top of their side navigation
 * (`admin.components.beforeNavLinks`) — in place of a tenant picker, which `04` §2.1 rules out
 * (Jason, 2026-11-04). Plain text: there is nothing to choose.
 *
 * Renders nothing for the district, who work across every site.
 */
export const SchoolNameNav = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  const me = user as AuthUser | null
  if (!sendsForApproval(me)) return null

  const label = schoolNamesLabel((await schoolsOf(payload, me)).map((s) => s.name))
  if (label === null) return null

  return (
    <p className={styles.navSchool} id="nav-school">
      <span className={styles.navSchoolLabel}>Your school</span>
      <span className={styles.navSchoolName}>{label}</span>
    </p>
  )
}

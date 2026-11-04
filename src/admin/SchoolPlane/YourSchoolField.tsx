import type { Payload, PayloadRequest } from 'payload'

import type { AuthUser } from '@/access/types'

import { schoolsOf } from './school-data'
import { schoolNamesLabel } from './school-plane'
import styles from './SchoolPlane.module.css'

/**
 * "Your school" on a school manager's own account page, as plain text — in place of the
 * multi-tenant plugin's `tenants` array, whose greyed-out dropdown reads as something to change
 * (Jason, 2026-11-04). Shown only to a school manager (the field's `admin.condition`), and
 * only their own account: they cannot open anyone else's.
 */
export const YourSchoolField = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  const label = schoolNamesLabel(
    (await schoolsOf(payload, user as AuthUser | null)).map((s) => s.name),
  )
  if (label === null) return null

  return (
    <div className={`field-type ${styles.yourSchool}`} id="your-school">
      <p className={styles.yourSchoolLabel}>Your school</p>
      <p className={styles.yourSchoolName}>{label}</p>
    </div>
  )
}

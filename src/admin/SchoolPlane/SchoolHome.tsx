import { DefaultDashboard, type DashboardViewServerProps } from '@payloadcms/next/views'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'

import type { AuthUser } from '@/access/types'
import { BrandBand } from '@/admin/Brand/BrandBand'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { listMySubmissions, schoolsOf } from './school-data'
import { SCHOOL_TASKS, schoolEditPath, submissionStatus } from './school-plane'
import styles from './SchoolPlane.module.css'

/**
 * The admin's home screen (`admin.components.views.dashboard`).
 *
 * A district admin gets Payload's own dashboard, untouched — `DefaultDashboard` is a root
 * export and server-rendered, so unlike the document `Status` it can be handed back whole.
 *
 * A school manager gets the landing view `04` §2.2 describes: a few tasks named as verbs, then
 * what they have sent and where it stands. No collection names, no data model.
 */
export const SchoolHome = async (props: DashboardViewServerProps) => {
  const { req } = props.initPageResult
  if (!sendsForApproval(req.user as AuthUser | null)) return <DefaultDashboard {...props} />

  const [submissions, schools] = await Promise.all([
    listMySubmissions(req),
    schoolsOf(req.payload, req.user as AuthUser | null),
  ])

  return (
    <Gutter>
      <div className={styles.view} id="school-home">
        <BrandBand payload={req.payload} {...(schools[0] ? { school: schools[0] } : {})} />
        <h1 className={styles.title}>What would you like to do?</h1>

        <ul className={styles.tasks}>
          {SCHOOL_TASKS.map((task) => (
            <li key={task.href}>
              <Link className={styles.task} href={task.href}>
                <span className={styles.taskLabel}>{task.label}</span>
                <span className={styles.taskDescription}>{task.description}</span>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className={styles.subtitle}>Your recent submissions</h2>
        {submissions.length === 0 ? (
          <p className={styles.empty}>Nothing is waiting for the district right now.</p>
        ) : (
          <ul className={styles.rows}>
            {submissions.map((row) => (
              <li className={styles.row} key={`${row.collection}-${row.id}`}>
                <Link href={schoolEditPath(row.collection, row.id)}>{row.title}</Link>
                <span className={styles.state}>{submissionStatus(row.reviewState)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Gutter>
  )
}

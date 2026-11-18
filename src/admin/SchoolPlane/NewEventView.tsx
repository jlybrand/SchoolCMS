import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

import { NewEventForm } from './NewEventForm'
import { listImportedCalendars, listMyCalendars } from './school-data'
import styles from './SchoolPlane.module.css'

/**
 * "Add an event" (Jason, 2026-11-11; `04` §2.2's "Add a meeting date") — the constrained create.
 *
 * Asks only what an event cannot exist without: its name and when it starts, and the calendar
 * when the school has more than one. Creating it up front is what lets autosave cover the rest on
 * the next screen, as for pages and announcements.
 *
 * School plane only; the district adds events through Payload's own form.
 */
export const NewEventView = async ({ initPageResult }: AdminViewServerProps) => {
  const { req } = initPageResult
  if (!sendsForApproval(req.user as AuthUser | null)) redirect('/admin/collections/events/create')

  const [calendars, imported] = await Promise.all([
    listMyCalendars(req),
    listImportedCalendars(req),
  ])

  return (
    <Gutter>
      <div className={styles.view} id="new-event">
        <p className={styles.back}>
          <Link href="/admin">Back to start</Link>
        </p>
        <h1 className={styles.title}>Add an event</h1>
        <NewEventForm calendars={calendars} imported={imported} />
      </div>
    </Gutter>
  )
}

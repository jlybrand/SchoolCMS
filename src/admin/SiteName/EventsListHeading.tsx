import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'

import { calendarFilterOf } from './calendar-filter'
import styles from './SiteName.module.css'

/**
 * Above the events list when it is ONE calendar's (Jason, 2026-11-18: Events → a calendar → a
 * list with no word of whose it is): "Site: School A · Calendar: …". The site for district admins
 * only — a school manager's one school is named in their menu; the calendar for everyone. Read as
 * the user; nothing when the list is not filtered to a single calendar.
 */
export const EventsListHeading = async ({
  payload,
  searchParams,
  user,
}: {
  payload: Payload
  searchParams?: unknown
  user: PayloadRequest['user']
}) => {
  const id = calendarFilterOf(searchParams)
  if (id === null) return null
  const calendar = await payload
    .findByID({
      collection: 'calendars',
      id,
      user,
      overrideAccess: false,
      depth: 1,
      select: { name: true, tenant: true },
    })
    .catch(() => null)
  if (!calendar) return null

  const tenant = (calendar as { tenant?: unknown }).tenant
  const site =
    isDistrictAdmin(user as AuthUser | null) && typeof tenant === 'object' && tenant !== null
      ? (tenant as { name?: unknown }).name
      : null

  return (
    <p className={styles.site} id="list-site">
      {typeof site === 'string' ? (
        <>
          <span className={styles.label}>Site</span>
          <strong className={styles.name}>{site}</strong>
        </>
      ) : null}
      <span className={styles.label}>Calendar</span>
      <strong className={styles.name}>{String(calendar.name ?? '')}</strong>
    </p>
  )
}

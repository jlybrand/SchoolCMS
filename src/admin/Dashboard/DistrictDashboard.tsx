import { Banner, Card } from '@payloadcms/ui'
import Link from 'next/link'
import type { Payload, PayloadRequest } from 'payload'

import { isDistrictAdmin, relationshipIdOf } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import {
  activityRow,
  approvalCards,
  approvalSummary,
  needsAttention,
  staleKeyPages,
  staleSites,
} from '@/lib/dashboard'
import { DISTRICT_TIME_ZONE } from '@/lib/queue-age'

import {
  findFeedFailures,
  findKeyPages,
  findLastPublished,
  findRecentActivity,
  findSites,
  findWaiting,
} from './dashboard-data'
import styles from './Dashboard.module.css'

/**
 * The top of the district's dashboard (`admin.components.beforeDashboard`; `04` §3.1, layout
 * decided by Jason, 2026-11-04): ① approvals ② what needs freshening ③ recent activity — under
 * banners for what needs acting on now (Payload's `Banner`, Jason 2026-11-12). The
 * auto-approval panel follows (`GrantsPanel`), then Payload's cards under "Everything else".
 *
 * Renders nothing for anyone else — school managers never see Payload's dashboard at all.
 */
export const DistrictDashboard = async ({
  payload,
  user,
}: {
  payload: Payload
  user: PayloadRequest['user']
}) => {
  if (!isDistrictAdmin(user as AuthUser | null)) return null

  const now = new Date()
  const tz = DISTRICT_TIME_ZONE
  const [waiting, sites, activity] = await Promise.all([
    findWaiting(payload, user),
    findSites(payload, user),
    findRecentActivity(payload, user),
  ])
  const names = new Map(sites.map((s) => [s.id, s.name]))
  const [last, keyPages, feedFailures] = await Promise.all([
    findLastPublished(
      payload,
      user,
      sites.map((s) => s.id),
      now,
    ),
    findKeyPages(payload, user, names),
    findFeedFailures(payload, user, names),
  ])

  const approvals = approvalSummary(waiting, now, tz)
  const cards = approvalCards(waiting)
  const attention = needsAttention({ overdue: approvals.overdue, feedFailures })
  const quietSites = staleSites(sites, last, now, tz)
  const quietPages = staleKeyPages(keyPages, now, tz)
  const rows = activity.flatMap((event) => {
    const site = relationshipIdOf(event.tenant as never)
    const row = activityRow(
      { ...event, school: site ? (names.get(site) ?? null) : null } as never,
      now,
      tz,
    )
    return row ? [row] : []
  })

  return (
    <div className={styles.dashboard} id="district-dashboard">
      <h1 className={styles.title}>District dashboard</h1>

      {attention.length > 0 ? (
        <section
          aria-labelledby="attention-heading"
          className={styles.attention}
          id="attention-panel"
        >
          <h2 className={styles.heading} id="attention-heading">
            Needs attention
          </h2>
          {/* One banner each, the whole banner a link to where it is fixed. */}
          <ul className={styles.banners}>
            {attention.map((item) => (
              <li key={item.href}>
                <Banner to={item.href} type={item.type}>
                  {item.text}
                </Banner>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={styles.grid}>
        <div className={styles.column}>
          <section
            aria-labelledby="approvals-heading"
            className={styles.panel}
            id="approvals-panel"
          >
            <h2 className={styles.heading} id="approvals-heading">
              Approvals
            </h2>
            {/* Overdue is said once, in the banner above. */}
            <p className={styles.lead}>{approvals.text}</p>
            {/* Each kind opens the queue at that kind (`queue-filter.ts`). */}
            <ul className={styles.cards}>
              {cards.map((card) => (
                <li key={card.id}>
                  <Card
                    buttonAriaLabel={card.label}
                    href={card.href}
                    id={card.id}
                    title={card.title}
                  />
                </li>
              ))}
            </ul>
            {/* Always, as the banner it replaces did: the queue is the way in even when empty. */}
            <p className={styles.action}>
              <Link href="/admin/approvals">Open the approval queue</Link>
            </p>
          </section>

          <section
            aria-labelledby="freshness-heading"
            className={styles.panel}
            id="freshness-panel"
          >
            <h2 className={styles.heading} id="freshness-heading">
              Needs freshening
            </h2>
            {quietSites.length === 0 && quietPages.length === 0 ? (
              <p className={styles.muted}>
                Every site and key page has changed in the last 90 days.
              </p>
            ) : null}
            {quietSites.length > 0 ? (
              <>
                <h3 className={styles.subheading}>Sites with no change in 90 days</h3>
                <ul className={styles.list}>
                  {quietSites.map((site) => (
                    <li key={site.id}>
                      <span className={styles.strong}>{site.name}</span> —{' '}
                      <span className={styles.muted}>{site.last}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {quietPages.length > 0 ? (
              <>
                <h3 className={styles.subheading}>Key pages unchanged in 90 days</h3>
                <ul className={styles.list}>
                  {quietPages.map((page) => (
                    <li key={page.id}>
                      {page.site} · {page.kind}: <Link href={page.href}>{page.title}</Link> —{' '}
                      <span className={styles.muted}>{page.last}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        </div>

        <section aria-labelledby="activity-heading" className={styles.panel} id="activity-panel">
          <h2 className={styles.heading} id="activity-heading">
            Recent activity
          </h2>
          {rows.length === 0 ? (
            <p className={styles.muted}>Nothing yet.</p>
          ) : (
            <ul className={styles.activity}>
              {rows.map((row, index) => (
                <li className={styles.event} key={index}>
                  <span className={styles.school}>{row.school}</span>
                  <span>
                    {row.href ? <Link href={row.href}>{row.sentence}</Link> : row.sentence}
                  </span>
                  <span className={styles.muted}>{row.when}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.action}>
            <Link href="/admin/collections/audit-events">See the full activity log</Link>
          </p>
        </section>
      </div>
    </div>
  )
}

/**
 * The heading over Payload's own cards, last before them (`beforeDashboard`), so they read as
 * the rest of the admin rather than as more of the dashboard. District only, like the cards.
 */
export const EverythingElseHeading = ({ user }: { user: PayloadRequest['user'] }) =>
  isDistrictAdmin(user as AuthUser | null) ? (
    <h2 className={styles.everythingElse} id="everything-else">
      Everything else
    </h2>
  ) : null

import { Banner, Card, Pill, Table } from '@payloadcms/ui'
import Link from 'next/link'
import type { ClientField, Column, Payload, PayloadRequest } from 'payload'
import type { ReactNode } from 'react'

import { isDistrictAdmin, relationshipIdOf } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import {
  activityRow,
  approvalCards,
  approvalSummary,
  freshnessRows,
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
  const stale = freshnessRows(quietSites, quietPages, tz)
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
            {stale.length === 0 ? (
              <p className={styles.muted}>
                Every site and key page has changed in the last 90 days.
              </p>
            ) : (
              <>
                <p className={styles.lead}>
                  {stale.length === 1
                    ? '1 site or key page has not changed in 90 days.'
                    : `${stale.length} sites or key pages have not changed in 90 days.`}{' '}
                  Longest first.
                </p>
                <div className={styles.table}>
                  <Table
                    appearance="condensed"
                    columns={[
                      column(
                        'site',
                        'Site',
                        stale.map((row) => row.site),
                      ),
                      column(
                        'what',
                        'What',
                        stale.map((row) =>
                          row.href ? (
                            <Link href={row.href} key={row.id}>
                              {row.what}
                            </Link>
                          ) : (
                            row.what
                          ),
                        ),
                      ),
                      column(
                        'when',
                        'Last changed',
                        stale.map((row) => row.when),
                      ),
                    ]}
                    data={stale}
                  />
                </div>
              </>
            )}
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
                  {/* Divs: Payload's Pill renders a <div>, which a <span> cannot hold. */}
                  <div className={styles.rowHead}>
                    <span className={styles.school}>{row.school}</span>
                    {/* The sentence says it in full; the pill is for the eye, so it is not read twice. */}
                    <div aria-hidden="true">
                      <Pill pillStyle={row.tag.style} rounded size="small">
                        {row.tag.label}
                      </Pill>
                    </div>
                  </div>
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
 * One column of Payload's `Table` (Jason, 2026-11-12). Table is built for list views, so each
 * column names a field; these are not collection fields, so a plain text one stands in. The
 * cells are rendered here and handed over in row order.
 */
const column = (accessor: string, heading: string, cells: ReactNode[]): Column => ({
  accessor,
  active: true,
  field: { name: accessor, type: 'text' } as ClientField,
  Heading: heading,
  renderedCells: cells,
})

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

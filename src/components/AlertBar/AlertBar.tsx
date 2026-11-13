import type { SiteAlert } from '@/content/types'

import { Link } from '../Link'

import { DismissibleAlert } from './DismissibleAlert'
import styles from './AlertBar.module.css'

/**
 * The alert banners above a site's header (Jason, 2026-11-12) — `getAlerts` has already chosen
 * which belong on this page now, and in what order (emergencies first).
 *
 * NEVER COLOR ALONE (`07` §3, 1.4.1): each banner says what it is in words — Emergency, Warning,
 * Notice — before its message. A region named "Alerts", before the site's own header, so a
 * screen-reader user meets it first after the skip link. Not a live region: it is the page's
 * content as it was served, and a live region on load is read twice by some screen readers.
 *
 * Info and warning can be closed by a visitor for their visit (`DismissibleAlert`); an emergency
 * cannot.
 */

export const SEVERITY_WORDS: Record<SiteAlert['severity'], string> = {
  emergency: 'Emergency',
  warning: 'Warning',
  info: 'Notice',
}

export type AlertBarProps = {
  readonly alerts: readonly SiteAlert[]
  /** Visitor-facing words, so Phase 7 translates them rather than leaving English behind. */
  readonly label?: string
  readonly closeLabel?: string
}

const Message = ({ alert }: { alert: SiteAlert }) => (
  <p className={styles.message}>
    <strong className={styles.kind}>{SEVERITY_WORDS[alert.severity]}:</strong> {alert.text}
    {alert.link ? (
      <>
        {' '}
        <Link href={alert.link.href} variant="inverse">
          {alert.link.label}
        </Link>
      </>
    ) : null}
  </p>
)

export const AlertBar = ({ alerts, label = 'Alerts', closeLabel = 'Close' }: AlertBarProps) => {
  if (alerts.length === 0) return null
  return (
    <section aria-label={label} className={styles.bar} id="site-alerts">
      {alerts.map((alert) =>
        alert.dismissible ? (
          <DismissibleAlert
            closeLabel={closeLabel}
            id={alert.id}
            key={alert.id}
            severity={alert.severity}
            version={alert.version}
          >
            <Message alert={alert} />
          </DismissibleAlert>
        ) : (
          <div className={styles.alert} data-severity={alert.severity} key={alert.id}>
            <Message alert={alert} />
          </div>
        ),
      )}
    </section>
  )
}

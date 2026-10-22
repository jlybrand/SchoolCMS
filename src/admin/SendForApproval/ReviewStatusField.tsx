'use client'

import { useFormFields } from '@payloadcms/ui'

import { describeReview } from './review-status'
import styles from './ReviewStatusField.module.css'

/**
 * DD2 is one district in one time zone. The date a school sent something is that day there,
 * whatever the browser or server is set to.
 */
const DISTRICT_TIME_ZONE = 'America/New_York'

/**
 * Where a school manager's change stands, at the top of the page form (`04` §2.3).
 *
 * It replaces Payload's "Draft" / "Published" / "Changed" status, which `04` §2.1 rules out
 * showing a school manager — that status is hidden for them in `send-for-approval.css`.
 *
 * A `ui` field rather than Payload's `Status` slot. The slot would have to render Payload's own
 * status for the district, and that component is not exported: the only route to it is a deep
 * import, which loads a second copy of Payload's React context and crashed the district's
 * page. Here, the role decision is the field's `admin.condition` (`src/collections/Pages.ts`),
 * and the district's controls are never touched.
 *
 * Read from the FORM, not the stored document, so it changes the moment "Send for approval"
 * returns: Payload resets the form from the saved document, which carries the new state.
 * `role="status"` so a screen reader hears that change without focus moving.
 *
 * Styled from Payload's theme variables, not DD2 tokens, which are not loaded in the admin
 * and do not follow its dark theme — see the stylesheet.
 */
export const ReviewStatusField = () => {
  const reviewState = useFormFields(([fields]) => fields.reviewState?.value)
  const reviewNote = useFormFields(([fields]) => fields.reviewNote?.value)
  const submittedAt = useFormFields(([fields]) => fields.submittedAt?.value)
  const status = describeReview({ reviewState, reviewNote, submittedAt }, DISTRICT_TIME_ZONE)

  return (
    <div className={styles.status} data-tone={status.tone} id="review-status" role="status">
      <p className={styles.heading}>{status.heading}</p>
      {status.note ? <p className={styles.note}>{status.note}</p> : null}
      <p className={styles.detail}>{status.detail}</p>
    </div>
  )
}

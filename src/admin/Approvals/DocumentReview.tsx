import type { UIFieldServerComponent } from 'payload'

import { DocumentApproval } from './DocumentApproval'
import { loadQueueItem } from './queue-data'
import styles from './Approvals.module.css'

/**
 * The approval queue's review, on the page or announcement itself (Jason, 2026-11-12): the diff
 * panel, Approve (with an announcement's dates) and Request changes, so the reviewer who opened
 * the document does not have to go back to the queue to publish it.
 *
 * It IS the queue's item — the same read (`loadQueueItem`), the same component, the same approve
 * endpoint and version token — so there is one approval path and one version check. The header
 * keeps "Review in the approval queue" as the way to the rest of the queue.
 *
 * District only, and only while the document waits: the field's condition hides it otherwise, and
 * `loadQueueItem` returns nothing for anyone else, so nothing is read for them either.
 */
export const DocumentReview: UIFieldServerComponent = async ({ req, id, collectionSlug }) => {
  if (id === undefined || (collectionSlug !== 'pages' && collectionSlug !== 'posts')) return null
  const item = await loadQueueItem(req, collectionSlug, id)
  if (!item) return null
  return (
    <div className={styles.documentReview} id="document-review">
      <p className={styles.documentReviewLead}>
        {item.school} sent this {item.noun} for approval. Check what changed, then approve it or
        send it back.
      </p>
      <DocumentApproval item={item} />
    </div>
  )
}

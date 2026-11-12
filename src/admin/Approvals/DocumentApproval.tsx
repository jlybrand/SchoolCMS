'use client'

import { toast, useDocumentInfo } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'

import { ApprovalItem, type Decision } from './ApprovalItem'
import type { QueueItem } from './queue-data'

/**
 * The queue's item on the document (`DocumentReview.tsx`, Jason 2026-11-12), plus what the queue
 * does not need: after a decision, the document's own state is brought up to date. Payload keeps
 * "is this live?" in client state that a refresh does not reread, so a publish is told to it —
 * as Payload's own Publish does — and the form is refreshed for the review fields. The outcome is
 * said in a toast, which outlives the panel the refresh removes.
 */
export const DocumentApproval = ({ item }: { item: QueueItem }) => {
  const router = useRouter()
  const { setHasPublishedDoc, setUnpublishedVersionCount, setMostRecentVersionIsAutosaved } =
    useDocumentInfo()

  const decided = (decision: Decision, outcome: string) => {
    toast.success(outcome)
    if (decision === 'published') {
      setHasPublishedDoc(true)
      setUnpublishedVersionCount(0)
      setMostRecentVersionIsAutosaved(false)
    }
    router.refresh()
  }

  return <ApprovalItem item={item} onDecided={decided} place="document" />
}

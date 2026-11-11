'use client'

import { PublishButton, useAuth } from '@payloadcms/ui'

import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

/**
 * Fills Payload's `PublishButton` slot on `events` (Jason, 2026-11-11: events do not go through
 * approval).
 *
 * Payload's own publish — a school manager's event goes straight onto their calendar — with the
 * school plane's words: "publish" is not theirs (`04` §2.1), and what the button does is put the
 * event on the calendar. The district keeps Payload's own label.
 */
export const EventSaveButton = () => {
  const { user } = useAuth()
  return sendsForApproval(user as AuthUser | null) ? (
    <PublishButton label="Save to the calendar" />
  ) : (
    <PublishButton />
  )
}

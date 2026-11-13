import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

import { STAFF_SYNC } from '@/sync/staff-sync'

import { revalidateAllSites } from './revalidate-on-publish'

/**
 * Staff lists (Jason, 2026-11-13) can sit on any page of any site, and which ones is cheaper to
 * over-cover than to work out — as for alerts. A district edit (a sort name, a sub-group, who is
 * in it) refreshes every site. A SYNC write is skipped: the run refreshes once at its end.
 */
export const revalidateStaffChange: CollectionAfterChangeHook = async ({
  doc,
  req,
  collection,
}) => {
  if (!req.context?.[STAFF_SYNC])
    await revalidateAllSites(req, `${collection.slug} ${String(doc.id)}`)
  return doc
}

export const revalidateStaffDelete: CollectionAfterDeleteHook = async ({
  doc,
  req,
  collection,
}) => {
  if (!req.context?.[STAFF_SYNC]) {
    await revalidateAllSites(req, `${collection.slug} ${String(doc.id)} removed`)
  }
  return doc
}

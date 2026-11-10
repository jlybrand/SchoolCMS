import type { CollectionBeforeValidateHook } from 'payload'

import { composeBody, hasWords } from '@/lib/compose-page'

/**
 * Every page composed (Jason, 2026-11-04) — the EXPAND step of retiring `body` and `standard`.
 *
 * `body` is off the form, but words still arrive in it: a page `pnpm run compose:pages` has not
 * reached, a restored old version, a clone, an API client. This hook makes every write leave them
 * as a Text section on top of the sections and the page `composed`, so nothing new lands in
 * `body`, and the contract step can drop it.
 *
 * BEFORE VALIDATE, so the new section gets its id, defaults and validation like any other, and
 * `schoolLayoutGate` (beforeChange) sees it — a Text section, which a school may add.
 *
 * The words are the ones the write SENDS in `body`, or the stored ones when it sends none. A write
 * that sends `body: null` emptied it: nothing moves.
 */
export const composeBodyOnWrite: CollectionBeforeValidateHook = ({ data, originalDoc }) => {
  if (!data) return data
  const sent = 'body' in data
  const body = sent ? data.body : originalDoc?.body
  if (!hasWords(body)) {
    return { ...data, ...(sent ? { body: null } : {}), pageType: 'composed' }
  }
  const layout = 'layout' in data ? data.layout : originalDoc?.layout
  return { ...data, layout: composeBody(body, layout).layout, body: null, pageType: 'composed' }
}

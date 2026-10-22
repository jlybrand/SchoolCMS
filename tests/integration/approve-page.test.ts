import { createLocalReq, type Payload, type TypedUser } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { approvePage, latestVersionToken } from '@/collections/endpoints/approve-page'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Approve publishes the version the reviewer SAW (`04` §4.1–4.2) — against real Payload, with
 * its real drafts, versions and autosave.
 *
 * The pure rule is `tests/unit/access/approval.test.ts`; this proves the operation around it:
 * that the token the queue reads is the one approve checks, that an autosave in between is
 * caught, and that what goes live is exactly what was read.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const live = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: false, depth: 0, overrideAccess: true })
const latest = (id: number) =>
  payload.findByID({ collection: 'pages', id, draft: true, depth: 0, overrideAccess: true })

const asUser = async (user: TypedUser) => createLocalReq({ user }, payload)

let seq = 0
/** A page in School A, sent for approval by School A's manager. */
const submittedPage = async (title = 'Bus routes') => {
  seq += 1
  const page = await payload.create({
    collection: 'pages',
    data: {
      tenant: f.tenantA,
      title: `${title} ${seq}`,
      slug: `approve-${Date.now()}-${seq}`,
      pageType: 'standard',
      visibility: 'public',
      reviewState: 'submitted',
    },
    draft: true,
    user: f.managerA,
    overrideAccess: false,
  })
  return page.id
}

describe('approvePage', () => {
  it('publishes the version the district saw, and clears the review state', async () => {
    const id = await submittedPage()
    const seen = await latestVersionToken(payload, id)
    expect(seen).not.toBeNull()

    const result = await approvePage(await asUser(f.districtAdmin), id, seen)
    expect(result).toEqual({ ok: true })

    const published = await live(id)
    expect(published._status).toBe('published')
    expect(published.title).toMatch(/^Bus routes \d+$/)
    expect(published.reviewState ?? null).toBeNull()
    expect(published.submittedBy ?? null).toBeNull()
  })

  it('refuses when the school autosaved after the district looked, and publishes nothing', async () => {
    const id = await submittedPage('Lunch menu')
    const seen = await latestVersionToken(payload, id)

    // The school keeps typing. Autosave rewrites the latest version IN PLACE.
    await payload.update({
      collection: 'pages',
      id,
      data: { title: 'Lunch menu — CHANGED AFTER REVIEW' },
      draft: true,
      autosave: true,
      user: f.managerA,
      overrideAccess: false,
    })

    const result = await approvePage(await asUser(f.districtAdmin), id, seen)
    expect(result).toEqual({ ok: false, reason: 'changed' })
    expect((await live(id))._status).not.toBe('published')
    expect((await latest(id)).reviewState).toBe('submitted')
  })

  it('refuses a school manager, whatever token they hold', async () => {
    const id = await submittedPage()
    const seen = await latestVersionToken(payload, id)
    expect(await approvePage(await asUser(f.managerA), id, seen)).toEqual({
      ok: false,
      reason: 'forbidden',
    })
    expect((await live(id))._status).not.toBe('published')
  })

  it('refuses a page that is not waiting', async () => {
    const id = await submittedPage()
    await payload.update({
      collection: 'pages',
      id,
      data: { reviewState: 'changes-requested', reviewNote: 'Add the times.' },
      draft: true,
      user: f.districtAdmin,
      overrideAccess: false,
    })
    const seen = await latestVersionToken(payload, id)
    expect(await approvePage(await asUser(f.districtAdmin), id, seen)).toEqual({
      ok: false,
      reason: 'not-waiting',
    })
  })

  it('refuses a token from an earlier version once a newer one exists', async () => {
    const id = await submittedPage('Library hours')
    const stale = await latestVersionToken(payload, id)
    await payload.update({
      collection: 'pages',
      id,
      data: { title: 'Library hours (new)' },
      draft: true,
      user: f.managerA,
      overrideAccess: false,
    })
    expect(await approvePage(await asUser(f.districtAdmin), id, stale)).toEqual({
      ok: false,
      reason: 'changed',
    })
  })

  it('an unknown page is not found', async () => {
    expect(
      await approvePage(await asUser(f.districtAdmin), 999_999, {
        versionId: '1',
        updatedAt: new Date().toISOString(),
      }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

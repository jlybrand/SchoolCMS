import { ValidationError, type Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { NEEDS_SCHOOL } from '@/access/user-school'

import { getTestPayload, SEED_PASSWORD, seed, type Fixtures } from '../helpers/payload'

/**
 * A school manager must be assigned a school — against real Payload, so the hook is proven
 * wired on `users` and not only correct in isolation (`tests/unit/access/user-school.test.ts`).
 *
 * `overrideAccess` throughout: this is a validation rule, and it must hold for the district
 * admin's own writes, which access allows.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
})

/** The refusal is a ValidationError on `tenants`, carrying the plain-words message. */
const refusal = async (fn: () => Promise<unknown>) => {
  try {
    await fn()
  } catch (err) {
    return err
  }
  return null
}

const expectNeedsSchool = (err: unknown) => {
  expect(err).toBeInstanceOf(ValidationError)
  const errors = (err as ValidationError).data.errors
  expect(errors).toEqual([expect.objectContaining({ path: 'tenants', message: NEEDS_SCHOOL })])
}

let seq = 0
const email = () => `school-rule-${Date.now()}-${seq++}@test.local`

describe('a school manager must have a school', () => {
  it('creating one without a school is refused, and nothing is stored', async () => {
    const address = email()
    expectNeedsSchool(
      await refusal(() =>
        payload.create({
          collection: 'users',
          data: { email: address, password: SEED_PASSWORD, roles: ['school-manager'] },
          overrideAccess: true,
        }),
      ),
    )
    const stored = await payload.find({
      collection: 'users',
      where: { email: { equals: address } },
      overrideAccess: true,
    })
    expect(stored.totalDocs).toBe(0)
  })

  it('creating one with a school succeeds', async () => {
    const created = await payload.create({
      collection: 'users',
      data: {
        email: email(),
        password: SEED_PASSWORD,
        roles: ['school-manager'],
        tenants: [{ tenant: f.tenantA }],
      },
      overrideAccess: true,
    })
    expect(created.id).toBeTruthy()
  })

  it('removing the last school from a manager is refused', async () => {
    expectNeedsSchool(
      await refusal(() =>
        payload.update({
          collection: 'users',
          id: f.managerA.id,
          data: { tenants: [] },
          overrideAccess: true,
        }),
      ),
    )
  })

  it('a save that sends neither roles nor schools keeps a manager valid', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: f.managerA.id,
      data: { name: 'Manager A renamed' },
      overrideAccess: true,
    })
    expect(updated.name).toBe('Manager A renamed')
  })

  it('a district admin needs no school', async () => {
    const created = await payload.create({
      collection: 'users',
      data: { email: email(), password: SEED_PASSWORD, roles: ['district-admin'] },
      overrideAccess: true,
    })
    expect(created.id).toBeTruthy()
  })

  it('a manager stored without a school is refused other saves until given one', async () => {
    // `noTenantManager` is stored with no school by the seed, as an account made before this
    // rule would be (see `tests/helpers/payload.ts`).
    expectNeedsSchool(
      await refusal(() =>
        payload.update({
          collection: 'users',
          id: f.noTenantManager.id,
          data: { name: 'Still no school' },
          overrideAccess: true,
        }),
      ),
    )
  })
})

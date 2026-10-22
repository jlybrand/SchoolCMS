import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getTestPayload, isDenied, SEED_PASSWORD, seed, type Fixtures } from '../helpers/payload'

/**
 * INTERIM LOCAL AUTHENTICATION (`02` §7, ADR-6 — deliberate temporary deviation).
 *
 * The design specifies Entra ID OIDC and no stored credentials. Local auth is in place to
 * avoid a district IT dependency during development; see "Authentication" in CLAUDE.md for
 * what it costs and when it must be switched.
 *
 * **This whole file is deleted when Entra lands.** It is scoped narrowly to that fact: it
 * covers the credential handling we now own and would otherwise inherit from the district
 * directory. Everything about roles, tenants and isolation is auth-mechanism-agnostic and
 * lives in tenant-isolation.test.ts, which does NOT change at switchover.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

describe('login', () => {
  it('succeeds with correct credentials and returns the user with roles intact', async () => {
    const result = await payload.login({
      collection: 'users',
      data: { email: 'manager-a@test.local', password: SEED_PASSWORD },
    })

    expect(result.user?.id).toBe(f.managerA.id)
    expect(result.user?.roles).toEqual(['school-manager'])
  })

  it('fails with a wrong password', async () => {
    const denied = await isDenied(() =>
      payload.login({
        collection: 'users',
        data: { email: 'manager-a@test.local', password: 'definitely-not-the-one-42' },
      }),
    )
    expect(denied).toBe(true)
  })

  it('fails for an unknown account', async () => {
    const denied = await isDenied(() =>
      payload.login({
        collection: 'users',
        data: { email: 'nobody@test.local', password: SEED_PASSWORD },
      }),
    )
    expect(denied).toBe(true)
  })
})

describe('password policy is enforced on the API, not just the form', () => {
  /**
   * Same reasoning as required alt text (`07` §4.3): a rule enforced only in the admin UI
   * is not enforced. The hook is what makes the REST and Local API paths obey it.
   */
  const weak = [
    ['too short', 'ab1cd'],
    ['a common word', 'my-password-here'],
    ['no variety', 'aaaaaaaaaaaa'],
  ] as const

  it.each(weak)('rejects a password that is %s', async (_label, password) => {
    const denied = await isDenied(() =>
      payload.create({
        collection: 'users',
        data: {
          email: `weak-${Math.abs(hash(password))}@test.local`,
          password,
          roles: ['school-manager'],
          // A school, so the only thing under test is the password (`user-school.ts`).
          tenants: [{ tenant: f.tenantA }],
        },
        overrideAccess: true,
      }),
    )
    expect(denied).toBe(true)
  })

  it('accepts a compliant password', async () => {
    const created = await payload.create({
      collection: 'users',
      data: {
        email: 'compliant@test.local',
        password: 'quiet-lantern-37',
        roles: ['school-manager'],
        tenants: [{ tenant: f.tenantA }],
      },
      overrideAccess: true,
    })
    expect(created.id).toBeTruthy()
  })

  it('rejects a weak password on UPDATE as well as create', async () => {
    // Password changes are the path most likely to skip validation.
    const denied = await isDenied(() =>
      payload.update({
        collection: 'users',
        id: f.managerA.id,
        data: { password: 'short' },
        overrideAccess: true,
      }),
    )
    expect(denied).toBe(true)
  })

  it('leaves unrelated updates untouched when no password is supplied', async () => {
    // The hook must be a no-op when `password` is absent, or every edit would fail.
    const updated = await payload.update({
      collection: 'users',
      id: f.managerA.id,
      data: { name: 'Renamed Manager' },
      overrideAccess: true,
    })
    expect(updated.name).toBe('Renamed Manager')
  })
})

describe('credentials are never exposed', () => {
  it('does not return password or salt/hash material on read', async () => {
    const user = await payload.findByID({
      collection: 'users',
      id: f.managerA.id,
      overrideAccess: true,
    })

    const serialized = JSON.stringify(user)
    expect(serialized).not.toContain(SEED_PASSWORD)
    for (const key of ['password', 'salt', 'hash']) {
      expect(Object.keys(user)).not.toContain(key)
    }
  })
})

/** Tiny deterministic hash so each weak-password case gets a distinct email. */
function hash(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h << 5) - h + value.charCodeAt(i)
  return h | 0
}

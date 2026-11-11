import type { Payload } from 'payload'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

  describe('on password reset', () => {
    /**
     * The forgot-password link is its own write path. Payload hashes the new password before
     * the collection hooks run and hands them the user without it, so a hook-only policy never
     * sees it — the reset path needs its own proof.
     */
    const resetToken = async (email: string): Promise<string> => {
      const token = await payload.forgotPassword({
        collection: 'users',
        data: { email },
        disableEmail: true,
      })
      if (!token) throw new Error(`no reset token for ${email}`)
      return token
    }

    let email: string
    beforeAll(async () => {
      email = 'resetter@test.local'
      await payload.create({
        collection: 'users',
        data: {
          email,
          password: 'quiet-lantern-37',
          roles: ['school-manager'],
          tenants: [{ tenant: f.tenantA }],
        },
        overrideAccess: true,
      })
    })

    it.each(weak)('rejects a new password that is %s', async (_label, password) => {
      const token = await resetToken(email)
      const denied = await isDenied(() =>
        payload.resetPassword({
          collection: 'users',
          data: { token, password },
          overrideAccess: true,
        }),
      )
      expect(denied).toBe(true)
      // And the old password still works: a refused reset changed nothing.
      const login = await payload.login({
        collection: 'users',
        data: { email, password: 'quiet-lantern-37' },
      })
      expect(login.user?.email).toBe(email)
    })

    it('accepts a compliant new password, which then logs in', async () => {
      const token = await resetToken(email)
      await payload.resetPassword({
        collection: 'users',
        data: { token, password: 'amber-harbour-52' },
        overrideAccess: true,
      })
      const login = await payload.login({
        collection: 'users',
        data: { email, password: 'amber-harbour-52' },
      })
      expect(login.user?.email).toBe(email)
    })
  })
})

describe('the forgot-password email', () => {
  /**
   * The link must be absolute, on the district origin. Payload's own build of it falls back to an
   * empty origin here (no `serverURL`), and mail clients opened `http:///admin/reset/<token>`.
   */
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const requestReset = async () => {
    const send = vi.spyOn(payload.email, 'sendEmail').mockResolvedValue(undefined)
    const token = await payload.forgotPassword({
      collection: 'users',
      data: { email: 'manager-a@test.local' },
    })
    return { send, token }
  }

  it('links to the reset page on the district origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://dd2.example.org')
    const { send, token } = await requestReset()

    expect(send).toHaveBeenCalledTimes(1)
    const message = send.mock.calls[0]![0] as { to: string; html: string }
    expect(message.to).toBe('manager-a@test.local')
    expect(message.html).toContain(`href="https://dd2.example.org/admin/reset/${token}"`)
  })

  /**
   * Payload 3.93 throttles reset requests: one per account per 15 seconds (`minRequestInterval`,
   * its default), the rest silently ignored — no email, and nothing that says the address exists.
   * Kept: it stops anyone flooding a staff member's inbox with reset emails.
   */
  const clearThrottle = (email: string) =>
    payload.db.updateOne({
      collection: 'users',
      where: { email: { equals: email } },
      data: { resetPasswordRequestedAt: null },
    })

  it('a second request for the same account within 15 seconds sends nothing (Payload 3.93)', async () => {
    await clearThrottle('manager-a@test.local')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://dd2.example.org')
    const send = vi.spyOn(payload.email, 'sendEmail').mockResolvedValue(undefined)
    await payload.forgotPassword({ collection: 'users', data: { email: 'manager-a@test.local' } })
    await payload.forgotPassword({ collection: 'users', data: { email: 'manager-a@test.local' } })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends nothing rather than a dead link when the origin is not set', async () => {
    await clearThrottle('manager-a@test.local')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
    const send = vi.spyOn(payload.email, 'sendEmail').mockResolvedValue(undefined)
    const denied = await isDenied(() =>
      payload.forgotPassword({ collection: 'users', data: { email: 'manager-a@test.local' } }),
    )
    expect(denied).toBe(true)
    expect(send).not.toHaveBeenCalled()
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

import { describe, expect, it } from 'vitest'

import { resetPasswordLink } from '@/auth/reset-email'

/**
 * The link in the forgot-password email.
 *
 * Payload builds it from `config.serverURL`, which is unset here on purpose (setting it also
 * switches on Payload's CSRF allowlist — a separate decision). Without it Payload refuses to trust
 * the Host header and falls back to an EMPTY origin, so the email carried `/admin/reset/<token>`
 * and mail clients opened `http:///admin/reset/<token>`. The link is built from the district's
 * public origin instead.
 */

describe('resetPasswordLink', () => {
  it('is absolute, on the district origin', () => {
    expect(
      resetPasswordLink({
        serverUrl: 'https://dd2.example.org',
        adminRoute: '/admin',
        token: 'abc',
      }),
    ).toBe('https://dd2.example.org/admin/reset/abc')
  })

  it('does not double a trailing slash', () => {
    expect(
      resetPasswordLink({ serverUrl: 'http://localhost:3000/', adminRoute: '/admin', token: 't1' }),
    ).toBe('http://localhost:3000/admin/reset/t1')
  })

  it('escapes the token into the path', () => {
    expect(
      resetPasswordLink({ serverUrl: 'http://localhost:3000', adminRoute: '/admin', token: 'a/b' }),
    ).toBe('http://localhost:3000/admin/reset/a%2Fb')
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not a URL', 'localhost:3000'],
    ['a path, not an origin', '/admin'],
  ])('refuses to build a link when the origin is %s', (_label, serverUrl) => {
    // A dead link mailed to a locked-out user is worse than a loud failure the operator sees.
    expect(() => resetPasswordLink({ serverUrl, adminRoute: '/admin', token: 'abc' })).toThrow(
      /NEXT_PUBLIC_SERVER_URL/,
    )
  })
})

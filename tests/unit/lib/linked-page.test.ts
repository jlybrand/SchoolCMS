import { describe, expect, it } from 'vitest'

import {
  redirectHref,
  validateLinkTarget,
  withLocalPort,
  type LinkTargetFacts,
} from '@/lib/linked-page'

/**
 * Linked pages, internal redirect (Jason, 2026-10-29): a page that sends visitors to another
 * page — a district page, or one on its own site. Never an outside address (that is what a
 * button or a menu's web address is for), never itself, never a page that is itself linked.
 */

const target = (facts: Partial<LinkTargetFacts> = {}): LinkTargetFacts => ({
  id: '20',
  tenant: '1',
  tenantType: 'school',
  linkMode: 'none',
  ...facts,
})

describe('validateLinkTarget', () => {
  it('passes a page that is not linked, without looking anything up', () => {
    expect(
      validateLinkTarget({ mode: 'none', linkTo: 'site', pageId: '10', pageTenant: '1' }, null),
    ).toBe(true)
  })

  it('requires the page to send visitors to', () => {
    expect(
      validateLinkTarget({ mode: 'redirect', linkTo: 'site', pageId: '10', pageTenant: '1' }, null),
    ).toBe('Choose the page to send visitors to.')
  })

  it('passes a page on its own site', () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'site', pageId: '10', pageTenant: '1' },
        target(),
      ),
    ).toBe(true)
  })

  it('passes a district page', () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'district', pageId: '10', pageTenant: '1' },
        target({ tenant: '9', tenantType: 'district' }),
      ),
    ).toBe(true)
  })

  it("refuses another school's page", () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'site', pageId: '10', pageTenant: '1' },
        target({ tenant: '2' }),
      ),
    ).toMatch(/this site/)
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'district', pageId: '10', pageTenant: '1' },
        target({ tenant: '2', tenantType: 'school' }),
      ),
    ).toMatch(/district page/)
  })

  it('refuses the page itself', () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'site', pageId: '20', pageTenant: '1' },
        target({ id: '20' }),
      ),
    ).toMatch(/itself/)
  })

  /** A chain is two hops for every visitor, and two linked pages pointing at each other loop. */
  it('refuses a page that is itself linked', () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'site', pageId: '10', pageTenant: '1' },
        target({ linkMode: 'redirect' }),
      ),
    ).toMatch(/already/)
  })

  it('refuses a page that does not exist', () => {
    expect(
      validateLinkTarget(
        { mode: 'redirect', linkTo: 'site', pageId: '10', pageTenant: '1', targetId: '99' },
        null,
      ),
    ).toMatch(/no longer exists/)
  })
})

describe('redirectHref', () => {
  it('is a path on the same site, in the visitor’s language', () => {
    expect(redirectHref({ path: '/about', hostname: 'a.dd2.example' }, 'a.dd2.example', 'en')).toBe(
      '/about',
    )
    expect(redirectHref({ path: '/about', hostname: 'a.dd2.example' }, 'a.dd2.example', 'es')).toBe(
      '/es/about',
    )
  })

  it('is a full address on the district site, in the visitor’s language', () => {
    expect(redirectHref({ path: '/enroll', hostname: 'dd2.example' }, 'a.dd2.example', 'es')).toBe(
      'https://dd2.example/es/enroll',
    )
    expect(redirectHref({ path: '/', hostname: 'localhost' }, 'a.localhost', 'en')).toBe(
      'http://localhost/',
    )
  })

  /**
   * Local development only: `*.localhost` sites are told apart by hostname on ONE port, so a
   * redirect across them keeps the port the visitor is on. A real host never gets one.
   */
  it('keeps the visitor’s port between local sites, and never adds one to a real host', () => {
    expect(
      redirectHref({ path: '/enroll', hostname: 'localhost' }, 'a.localhost', 'en', '3100'),
    ).toBe('http://localhost:3100/enroll')
    expect(
      redirectHref({ path: '/enroll', hostname: 'dd2.example' }, 'a.dd2.example', 'en', '3100'),
    ).toBe('https://dd2.example/enroll')
  })
})

/**
 * Reuse content (Jason, 2026-10-29): the page shows a DISTRICT page's title and content at its
 * own address. The district picker only — a school's page is never the source.
 */
describe('validateLinkTarget — reuse content', () => {
  it('passes a district page', () => {
    expect(
      validateLinkTarget(
        { mode: 'reuse', linkTo: 'site', pageId: '10', pageTenant: '1' },
        target({ tenant: '9', tenantType: 'district' }),
      ),
    ).toBe(true)
  })

  it('refuses a school page, even its own site’s', () => {
    expect(
      validateLinkTarget(
        { mode: 'reuse', linkTo: 'site', pageId: '10', pageTenant: '1' },
        target({ tenant: '1', tenantType: 'school' }),
      ),
    ).toMatch(/district page/)
  })

  it('requires the page to show', () => {
    expect(
      validateLinkTarget(
        { mode: 'reuse', linkTo: 'district', pageId: '10', pageTenant: '1' },
        null,
      ),
    ).toMatch(/Choose the district page/)
  })

  it('refuses a district page that is itself linked', () => {
    expect(
      validateLinkTarget(
        { mode: 'reuse', linkTo: 'district', pageId: '10', pageTenant: '1' },
        target({ tenant: '9', tenantType: 'district', linkMode: 'reuse' }),
      ),
    ).toMatch(/already/)
  })

  it('refuses the page itself', () => {
    expect(
      validateLinkTarget(
        { mode: 'reuse', linkTo: 'district', pageId: '20', pageTenant: '9' },
        target({ id: '20', tenant: '9', tenantType: 'district' }),
      ),
    ).toMatch(/itself/)
  })
})

/**
 * Reused content's links are full district addresses with no port. Between `*.localhost` sites
 * in development, which share one port, the visitor's port is added — the same rule as a
 * redirect's (`redirectHref`).
 */
describe('withLocalPort', () => {
  it('adds the port to a link on that origin, and touches nothing else', () => {
    const rewrite = withLocalPort('http://localhost', '3100')
    expect(rewrite('http://localhost/enroll')).toBe('http://localhost:3100/enroll')
    expect(rewrite('http://localhost/')).toBe('http://localhost:3100/')
    expect(rewrite('http://localhost.evil.example/x')).toBe('http://localhost.evil.example/x')
    expect(rewrite('https://forms.office.com/x')).toBe('https://forms.office.com/x')
    expect(rewrite('/local')).toBe('/local')
  })
})

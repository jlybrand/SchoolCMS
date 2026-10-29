import { describe, expect, it } from 'vitest'

import { EMPTY_NAVIGATION, toNavigation } from '@/content/menus'

/**
 * The navigation mapper (`03` §5, `02` §11).
 *
 * The single point where a Payload `navigation` row becomes DD2 menus. It is handed
 * `unknown` on purpose: the row may predate a field, come from a migration, or have been
 * written around the admin's validators, and a menu renders on every page of a tenant — so
 * one malformed item must cost that item, never the header.
 */

const item = (label: unknown, href: unknown, extra: Record<string, unknown> = {}) => ({
  id: `row-${String(label)}`,
  label,
  href,
  ...extra,
})

describe('toNavigation', () => {
  it('maps the three menus, in the order they were authored', () => {
    const nav = toNavigation({
      primary: [item('About', '/about'), item('Calendar', '/calendar')],
      utility: [item('Staff email', 'https://outlook.office.com', { newTab: true })],
      footer: [item('Call the office', 'tel:+18435550100')],
    })

    expect(nav.primary.map((link) => link.label)).toEqual(['About', 'Calendar'])
    expect(nav.utility).toEqual([
      {
        id: 'row-Staff email',
        label: 'Staff email',
        href: 'https://outlook.office.com',
        newTab: true,
      },
    ])
    expect(nav.footer[0]?.href).toBe('tel:+18435550100')
  })

  it('returns DD2 menu links and nothing else — no Payload row fields leak through', () => {
    const nav = toNavigation({
      id: 7,
      tenant: 3,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      primary: [item('About', '/about', { blockName: 'x', _uuid: 'y' })],
    })

    expect(Object.keys(nav).sort()).toEqual(['footer', 'primary', 'utility'])
    expect(Object.keys(nav.primary[0] ?? {}).sort()).toEqual(['href', 'id', 'label', 'newTab'])
  })

  it('`newTab` is true only for a literal true', () => {
    const nav = toNavigation({
      primary: [
        item('A', '/a', { newTab: 'true' }),
        item('B', '/b', { newTab: 1 }),
        item('C', '/c', { newTab: null }),
        item('D', '/d'),
      ],
    })
    expect(nav.primary.map((link) => link.newTab)).toEqual([false, false, false, false])
  })

  it('drops an item with an unsafe destination, and keeps its neighbours', () => {
    const nav = toNavigation({
      primary: [
        item('About', '/about'),
        item('Bad', 'javascript:alert(1)'),
        item('Worse', '//evil.example'),
        item('Calendar', '/calendar'),
      ],
    })
    expect(nav.primary.map((link) => link.label)).toEqual(['About', 'Calendar'])
  })

  it('drops an item with no words — a link with no accessible name (WCAG 2.4.4, 4.1.2)', () => {
    const nav = toNavigation({
      primary: [item('', '/a'), item('   ', '/b'), item(null, '/c'), item('Kept', '/d')],
    })
    expect(nav.primary.map((link) => link.label)).toEqual(['Kept'])
  })

  it('trims the label and the destination', () => {
    const nav = toNavigation({ primary: [item('  About ', ' /about ')] })
    expect(nav.primary[0]).toMatchObject({ label: 'About', href: '/about' })
  })

  it('gives an item with no row id a positional one, so a list key always exists', () => {
    const nav = toNavigation({ footer: [{ label: 'About', href: '/about' }] })
    expect(nav.footer[0]?.id).toBe('footer-0')
  })

  it.each([[null], [undefined], ['navigation'], [42], [[]], [{}], [{ primary: 'About' }]])(
    'yields empty menus for %j — a tenant with no navigation row still renders',
    (doc) => {
      expect(toNavigation(doc)).toEqual(EMPTY_NAVIGATION)
    },
  )

  it('never hands out the shared empty value to be mutated', () => {
    const nav = toNavigation(null)
    nav.primary.push({ id: 'x', label: 'x', href: '/x', newTab: false })
    expect(toNavigation(null).primary).toEqual([])
  })
})

/**
 * A menu link may point at a PAGE rather than a typed address (Jason, 2026-10-29), so renaming
 * or moving the page never breaks the menu. The mapper is handed the tenant's current paths.
 */
describe('toNavigation — links to a page', () => {
  const paths = new Map([
    ['5', '/about/staff'],
    ['6', '/'],
  ])

  it('uses the page’s current path', () => {
    const nav = toNavigation(
      {
        primary: [
          item('Staff', null, { linkType: 'page', page: 5 }),
          item('Home', null, { linkType: 'page', page: { id: 6 } }),
        ],
      },
      paths,
    )
    expect(nav.primary.map((link) => link.href)).toEqual(['/about/staff', '/'])
  })

  it('ignores any stale address stored on a page link', () => {
    const nav = toNavigation(
      { primary: [item('Staff', '/old-staff', { linkType: 'page', page: 5 })] },
      paths,
    )
    expect(nav.primary[0]?.href).toBe('/about/staff')
  })

  /** An unpublished, staff-only, deleted or other-site page has no path here — and a menu entry that 404s is a bug (`03` §5). */
  it('drops a link to a page with no current path', () => {
    const nav = toNavigation(
      { primary: [item('Gone', null, { linkType: 'page', page: 99 }), item('About', '/about')] },
      paths,
    )
    expect(nav.primary.map((link) => link.label)).toEqual(['About'])
  })

  it('treats a row saved before link types existed as an address', () => {
    const nav = toNavigation({ primary: [item('About', '/about')] }, paths)
    expect(nav.primary[0]?.href).toBe('/about')
  })

  it('drops page links when no paths are given', () => {
    const nav = toNavigation({ primary: [item('Staff', null, { linkType: 'page', page: 5 })] })
    expect(nav.primary).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'

import { validateMenuPageLink } from '@/lib/menu-page-link'

/**
 * A menu link to a page must name a page on the menu's OWN site (Jason, 2026-10-29). The
 * render already drops anything else; this refuses it on write, so the admin says so instead
 * of saving a link that silently never shows.
 */
const lookups = (pages: Record<string, string>, menus: Record<string, string> = {}) => ({
  tenantOfPage: async (id: string) => pages[id] ?? null,
  tenantOfMenu: async (id: string) => menus[id] ?? null,
})

describe('validateMenuPageLink', () => {
  it('passes an address link without looking anything up', async () => {
    expect(
      await validateMenuPageLink({ linkType: 'address', page: null, tenant: '1' }, lookups({})),
    ).toBe(true)
  })

  it('requires a page on a page link', async () => {
    expect(
      await validateMenuPageLink({ linkType: 'page', page: null, tenant: '1' }, lookups({})),
    ).toBe('Choose the page this link goes to.')
  })

  it('passes a page on the same site', async () => {
    expect(
      await validateMenuPageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({ '5': '1' })),
    ).toBe(true)
  })

  it("refuses another site's page", async () => {
    expect(
      await validateMenuPageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({ '5': '2' })),
    ).toMatch(/this site/)
  })

  it('refuses a page that does not exist', async () => {
    expect(
      await validateMenuPageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({})),
    ).toMatch(/this site/)
  })

  /** A partial update names no tenant — the row being updated is the one that has it. */
  it("reads the menu's own site when the write does not name it", async () => {
    const deps = lookups({ '5': '2' }, { '9': '1' })
    expect(
      await validateMenuPageLink({ linkType: 'page', page: { id: 5 }, menuId: 9 }, deps),
    ).toMatch(/this site/)
    expect(
      await validateMenuPageLink(
        { linkType: 'page', page: 5, menuId: 9 },
        lookups({ '5': '1' }, { '9': '1' }),
      ),
    ).toBe(true)
  })

  it('refuses when the site cannot be told — never guesses', async () => {
    expect(
      await validateMenuPageLink({ linkType: 'page', page: 5 }, lookups({ '5': '1' })),
    ).toMatch(/this site/)
  })
})

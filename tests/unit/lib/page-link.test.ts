import { describe, expect, it } from 'vitest'

import { validatePageLink } from '@/lib/page-link'

/**
 * A link to a page — in a menu, a button or a card — must name a page on its OWN site (Jason,
 * 2026-10-29). The render already drops anything else; this refuses it on write, so the admin
 * says so instead of saving a link that silently never shows. The "owner" is the record the
 * link is saved in: the menu row, or the page whose block it is.
 */
const lookups = (pages: Record<string, string>, menus: Record<string, string> = {}) => ({
  tenantOfPage: async (id: string) => pages[id] ?? null,
  tenantOfOwner: async (id: string) => menus[id] ?? null,
})

describe('validatePageLink', () => {
  it('passes a link to nothing (an optional card link left empty)', async () => {
    expect(await validatePageLink({ linkType: 'none', page: null, tenant: '1' }, lookups({}))).toBe(
      true,
    )
  })

  it('passes an address link without looking anything up', async () => {
    expect(
      await validatePageLink({ linkType: 'address', page: null, tenant: '1' }, lookups({})),
    ).toBe(true)
  })

  it('requires a page on a page link', async () => {
    expect(await validatePageLink({ linkType: 'page', page: null, tenant: '1' }, lookups({}))).toBe(
      'Choose the page this link goes to.',
    )
  })

  it('passes a page on the same site', async () => {
    expect(
      await validatePageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({ '5': '1' })),
    ).toBe(true)
  })

  it("refuses another site's page", async () => {
    expect(
      await validatePageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({ '5': '2' })),
    ).toMatch(/this site/)
  })

  it('refuses a page that does not exist', async () => {
    expect(await validatePageLink({ linkType: 'page', page: 5, tenant: 1 }, lookups({}))).toMatch(
      /this site/,
    )
  })

  /** A partial update names no tenant — the row being updated is the one that has it. */
  it("reads the owner's own site when the write does not name it", async () => {
    const deps = lookups({ '5': '2' }, { '9': '1' })
    expect(await validatePageLink({ linkType: 'page', page: { id: 5 }, ownerId: 9 }, deps)).toMatch(
      /this site/,
    )
    expect(
      await validatePageLink(
        { linkType: 'page', page: 5, ownerId: 9 },
        lookups({ '5': '1' }, { '9': '1' }),
      ),
    ).toBe(true)
  })

  it('refuses when the site cannot be told — never guesses', async () => {
    expect(await validatePageLink({ linkType: 'page', page: 5 }, lookups({ '5': '1' }))).toMatch(
      /this site/,
    )
  })
})

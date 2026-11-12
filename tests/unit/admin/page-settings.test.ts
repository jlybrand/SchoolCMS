import { describe, expect, it } from 'vitest'

import {
  firstRefusedTab,
  missingRequired,
  SETTING_PATHS,
  SETTING_TABS,
  tabAfterKey,
  tabClass,
  tabFor,
} from '@/admin/PageToolbar/page-settings'

/** The Page settings dialog will not close on a page with no title or no address. */
describe('missingRequired', () => {
  it('is null when the page has both', () => {
    expect(missingRequired({ title: 'About', slug: 'about' })).toBeNull()
  })

  it('names the first one missing, title before address', () => {
    expect(missingRequired({ title: ' ', slug: '' })?.path).toBe('title')
    expect(missingRequired({ title: 'About', slug: '' })?.label).toBe('an address')
    expect(missingRequired({})?.path).toBe('title')
  })
})

/** Jason's four tabs, 2026-11-11: Page · Linking · SEO · Access. */
describe('the dialog’s tabs', () => {
  it('are Page, Linking, SEO and Access, in that order', () => {
    expect(SETTING_TABS.map((tab) => tab.label)).toEqual(['Page', 'Linking', 'SEO', 'Access'])
  })

  it('put every setting on exactly one tab', () => {
    for (const path of SETTING_PATHS) expect(tabFor(path), path).not.toBeNull()
  })

  it.each([
    ['title', 'page'],
    ['slug', 'page'],
    ['parent', 'page'],
    ['hideFromNavigation', 'page'],
    ['hideFromSiteSearch', 'page'],
    ['hideFromSearchEngines', 'page'],
    ['linkMode', 'linking'],
    ['linkTo', 'linking'],
    ['linkTarget', 'linking'],
    ['districtLinkTarget', 'linking'],
    ['meta.title', 'seo'],
    ['meta.description', 'seo'],
    ['visibility', 'access'],
  ])('puts %s on the %s tab', (path, tab) => {
    expect(tabFor(path)).toBe(tab)
  })

  it('leaves the Start out — it moves to publishing (Jason, 2026-11-11)', () => {
    expect(SETTING_PATHS).not.toContain('publishAt')
    expect(tabFor('publishAt')).toBeNull()
  })

  it('knows nothing of a path that is not a setting', () => {
    expect(tabFor('layout')).toBeNull()
    expect(tabFor('meta')).toBeNull()
  })

  it('gives each tab the class its fields carry', () => {
    expect(tabClass('seo')).toBe('dd2-settings-tab-seo')
  })
})

/** A refused setting on a hidden tab would be an error nobody can see. */
describe('firstRefusedTab', () => {
  it('is null when nothing was refused', () => {
    expect(firstRefusedTab([])).toBeNull()
    expect(firstRefusedTab(['layout'])).toBeNull()
  })

  it('opens the tab holding the refused setting', () => {
    expect(firstRefusedTab(['linkTarget'])).toBe('linking')
    expect(firstRefusedTab(['meta.title'])).toBe('seo')
  })

  it('takes the first tab in order when several are refused', () => {
    expect(firstRefusedTab(['meta.description', 'slug', 'linkTarget'])).toBe('page')
  })
})

/** Arrow keys move between tabs (WAI-ARIA tabs pattern), wrapping; Home and End go to the ends. */
describe('tabAfterKey', () => {
  it('moves along and wraps', () => {
    expect(tabAfterKey('page', 'ArrowRight', 'ltr')).toBe('linking')
    expect(tabAfterKey('access', 'ArrowRight', 'ltr')).toBe('page')
    expect(tabAfterKey('page', 'ArrowLeft', 'ltr')).toBe('access')
  })

  it('goes to the ends', () => {
    expect(tabAfterKey('seo', 'Home', 'ltr')).toBe('page')
    expect(tabAfterKey('linking', 'End', 'ltr')).toBe('access')
  })

  it('follows the reading direction in a right-to-left admin', () => {
    expect(tabAfterKey('page', 'ArrowLeft', 'rtl')).toBe('linking')
    expect(tabAfterKey('page', 'ArrowRight', 'rtl')).toBe('access')
  })

  it('ignores other keys', () => {
    expect(tabAfterKey('seo', 'Enter', 'ltr')).toBeNull()
    expect(tabAfterKey('seo', 'ArrowDown', 'ltr')).toBeNull()
  })
})

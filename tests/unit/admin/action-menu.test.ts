import { describe, expect, it } from 'vitest'

import { DISTRICT_MENU, SCHOOL_MENU, isCurrent, type MenuItem } from '@/admin/Nav/action-menu'

/**
 * The short menus of actions (Jason, 2026-11-18) — PURE: what each plane lists, in order, which
 * items open the panel beside the menu, and which item is the current place.
 */

const item = (menu: readonly MenuItem[], label: string) => menu.find((i) => i.label === label)!

describe('DISTRICT_MENU', () => {
  it('lists the district’s actions, in order', () => {
    expect(DISTRICT_MENU.map((i) => i.label)).toEqual([
      'Approvals',
      'Pages',
      'Announcements',
      'Events',
      'Alerts',
      'Users',
      'Files',
    ])
  })

  it('Pages, Announcements, Events and Files open the panel beside the menu', () => {
    expect(DISTRICT_MENU.filter((i) => i.panel).map((i) => [i.label, i.panel])).toEqual([
      ['Pages', 'pages'],
      ['Announcements', 'boards'],
      ['Events', 'calendars'],
      ['Files', 'files'],
    ])
  })

  it('keeps the ids the existing links had', () => {
    expect(item(DISTRICT_MENU, 'Approvals').id).toBe('nav-approvals')
    expect(item(DISTRICT_MENU, 'Files').id).toBe('nav-file-library')
  })
})

describe('SCHOOL_MENU — the same, less what is the district’s', () => {
  it('lists a school manager’s actions, in order', () => {
    expect(SCHOOL_MENU.map((i) => i.label)).toEqual(['Pages', 'Announcements', 'Events', 'Files'])
  })

  it('the same panels, and the same ids as the district’s', () => {
    for (const label of ['Pages', 'Announcements', 'Events', 'Files']) {
      expect(item(SCHOOL_MENU, label).id).toBe(item(DISTRICT_MENU, label).id)
      expect(item(SCHOOL_MENU, label).panel).toBe(item(DISTRICT_MENU, label).panel)
    }
  })

  it('their task screens count as the item they belong to', () => {
    expect(isCurrent(item(SCHOOL_MENU, 'Pages'), '/admin/update-page')).toBe(true)
    expect(isCurrent(item(SCHOOL_MENU, 'Pages'), '/admin/new-page')).toBe(true)
    expect(isCurrent(item(SCHOOL_MENU, 'Announcements'), '/admin/new-post')).toBe(true)
    expect(isCurrent(item(SCHOOL_MENU, 'Events'), '/admin/new-event')).toBe(true)
    expect(isCurrent(item(SCHOOL_MENU, 'Files'), '/admin/upload-file')).toBe(true)
    expect(isCurrent(item(SCHOOL_MENU, 'Files'), '/admin/replace-file')).toBe(true)
  })
})

describe('isCurrent', () => {
  it('the item’s own screen', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Approvals'), '/admin/approvals')).toBe(true)
  })

  it('a document under a collection’s list', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Users'), '/admin/collections/users/4')).toBe(true)
  })

  it('a page’s form counts as Pages, as does a site’s page tree', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Pages'), '/admin/collections/pages/12')).toBe(true)
    expect(isCurrent(item(DISTRICT_MENU, 'Pages'), '/admin/site-pages')).toBe(true)
  })

  it('a post’s form counts as Announcements', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Announcements'), '/admin/collections/posts/3')).toBe(true)
  })

  it('not a longer slug that merely starts the same', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Pages'), '/admin/collections/pages-archive')).toBe(false)
  })

  it('elsewhere', () => {
    expect(isCurrent(item(DISTRICT_MENU, 'Alerts'), '/admin')).toBe(false)
  })
})

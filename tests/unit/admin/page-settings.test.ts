import { describe, expect, it } from 'vitest'

import { missingRequired } from '@/admin/PageToolbar/page-settings'

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

import { describe, expect, it } from 'vitest'

import { pathIndex } from '@/content/page-tree'

/**
 * Page id -> its current path, from one tenant's published, public rows. This is what turns a
 * permalink or a menu link to a page into the address the page has TODAY, so a rename or a
 * move never strands a link.
 */
const row = (id: number, slug: string, parent: number | null = null) => ({ id, slug, parent })

describe('pathIndex', () => {
  it('maps top-level and nested pages to their paths', () => {
    const paths = pathIndex([row(1, 'about'), row(2, 'staff', 1), row(3, 'office', 2)])
    expect(paths.get('1')).toBe('/about')
    expect(paths.get('2')).toBe('/about/staff')
    expect(paths.get('3')).toBe('/about/staff/office')
  })

  it('puts the front page at /', () => {
    expect(pathIndex([row(1, 'home')]).get('1')).toBe('/')
  })

  it('accepts a parent given as a relationship object', () => {
    const paths = pathIndex([row(1, 'about'), { id: 2, slug: 'staff', parent: { id: 1 } }])
    expect(paths.get('2')).toBe('/about/staff')
  })

  /** Each of these has no reachable URL, so it has no path — never a shortened, invented one. */
  it('leaves out a page whose parent is not in the set (unpublished or staff-only)', () => {
    expect(pathIndex([row(2, 'staff', 1)]).has('2')).toBe(false)
  })

  it('leaves out a page nested under the front page', () => {
    expect(pathIndex([row(1, 'home'), row(2, 'about', 1)]).has('2')).toBe(false)
  })

  it('leaves out a parent cycle rather than looping', () => {
    const paths = pathIndex([row(1, 'a', 2), row(2, 'b', 1)])
    expect(paths.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'

import { filterQueue, queueKindFrom, queueSummary } from '@/admin/Approvals/queue-filter'

/**
 * The approval queue narrowed to one kind — what a dashboard card opens (Jason, 2026-11-12).
 * `?kind=pages` or `?kind=posts`; anything else is the whole queue.
 */

const item = (collection: 'pages' | 'posts', id: number) => ({ collection, id })

describe('queueKindFrom', () => {
  it('reads pages or announcements from the address', () => {
    expect(queueKindFrom({ kind: 'pages' })).toBe('pages')
    expect(queueKindFrom({ kind: 'posts' })).toBe('posts')
  })

  it('is the whole queue for nothing, or anything else', () => {
    expect(queueKindFrom(undefined)).toBeNull()
    expect(queueKindFrom({})).toBeNull()
    expect(queueKindFrom({ kind: 'events' })).toBeNull()
    expect(queueKindFrom({ kind: ['pages', 'posts'] })).toBeNull()
  })
})

describe('filterQueue', () => {
  const items = [item('pages', 1), item('posts', 2), item('pages', 3)]

  it('keeps one kind, in the order it was in', () => {
    expect(filterQueue(items, 'pages').map((i) => i.id)).toEqual([1, 3])
    expect(filterQueue(items, 'posts').map((i) => i.id)).toEqual([2])
  })

  it('keeps everything for the whole queue', () => {
    expect(filterQueue(items, null)).toEqual(items)
  })
})

describe('queueSummary', () => {
  it('the whole queue, as it said before', () => {
    expect(queueSummary(0, null)).toBe(
      'Nothing is waiting. Every school’s changes have been dealt with.',
    )
    expect(queueSummary(1, null)).toBe('1 submission is waiting, oldest first.')
    expect(queueSummary(3, null)).toBe('3 submissions are waiting, oldest first.')
  })

  it('one kind, in its own words', () => {
    expect(queueSummary(0, 'pages')).toBe('No pages are waiting.')
    expect(queueSummary(1, 'pages')).toBe('1 page is waiting, oldest first.')
    expect(queueSummary(2, 'posts')).toBe('2 announcements are waiting, oldest first.')
  })
})

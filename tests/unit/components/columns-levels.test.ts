import { describe, expect, it } from 'vitest'

import { columnLevels } from '@/blocks/Columns/levels'

/**
 * Heading levels inside Columns (Jason, 2026-11-04: nesting allowed). Each heading is one step
 * below the nearest heading above it, so placing blocks in columns can never skip a level —
 * nobody has to check the outline by hand (`03` §3.2's claim, kept under nesting).
 */
describe('columnLevels', () => {
  it('with a block heading and a column heading: h2, h3, and blocks from h4', () => {
    expect(columnLevels(2, { blockHeading: true, columnHeading: true })).toEqual({
      block: 2,
      column: 3,
      content: 4,
    })
  })

  it('with no block heading, a column heading takes its place', () => {
    expect(columnLevels(2, { blockHeading: false, columnHeading: true })).toEqual({
      block: 2,
      column: 2,
      content: 3,
    })
  })

  it('with no headings at all, the blocks sit where the columns do', () => {
    expect(columnLevels(2, { blockHeading: false, columnHeading: false }).content).toBe(2)
  })

  it('with only a block heading, the blocks are one below it', () => {
    expect(columnLevels(3, { blockHeading: true, columnHeading: false }).content).toBe(4)
  })

  it('never goes past h6', () => {
    expect(columnLevels(6, { blockHeading: true, columnHeading: true })).toEqual({
      block: 6,
      column: 6,
      content: 6,
    })
  })
})

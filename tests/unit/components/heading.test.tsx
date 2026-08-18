// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { Heading, clampHeadingLevel, nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'

import { renderComponent } from '../../helpers/render'

/**
 * Block-owned heading levels (`03` §3, `07` §3).
 *
 * The conformance claim is that *an editor cannot produce a heading-order violation by
 * reordering blocks*. That holds because a heading level is never an editable field: it is
 * derived from position in the page outline and threaded down as a prop. These tests pin
 * the two halves that make the derivation safe — the level→element mapping, and the
 * arithmetic that walks the outline without ever running off the end of it.
 */

const LEVELS: HeadingLevel[] = [1, 2, 3, 4, 5, 6]

describe('Heading', () => {
  it.each(LEVELS)('level %i renders the matching heading element', (level) => {
    const { getByRole } = renderComponent(<Heading level={level}>Board meeting</Heading>)

    const heading = getByRole('heading', { level })
    expect(heading.tagName).toBe(`H${level}`)
    expect(heading).toHaveProperty('textContent', 'Board meeting')
  })

  it('sizes visually by level when no size is given', () => {
    const { getByRole } = renderComponent(<Heading level={2}>Notices</Heading>)
    expect(getByRole('heading', { level: 2 }).dataset.size).toBe('xl')
  })

  it('decouples visual size from level', () => {
    /**
     * Needed precisely because levels are not editable. A block placed deep in an outline
     * may own an `h4` that still has to read as a section title, and the alternative —
     * letting the template pick a bigger heading element — is the heading-order violation
     * this design exists to prevent.
     */
    const { getByRole } = renderComponent(
      <Heading level={4} size="2xl">
        Superintendent&apos;s message
      </Heading>,
    )

    const heading = getByRole('heading', { level: 4 })
    expect(heading.tagName).toBe('H4')
    expect(heading.dataset.size).toBe('2xl')
  })

  it('passes an id through so a landmark can reference it', () => {
    const { getByRole } = renderComponent(
      <Heading level={2} id="agenda">
        Agenda
      </Heading>,
    )
    expect(getByRole('heading', { level: 2 }).id).toBe('agenda')
  })
})

describe('clampHeadingLevel', () => {
  it('keeps valid levels untouched', () => {
    for (const level of LEVELS) expect(clampHeadingLevel(level)).toBe(level)
  })

  it('never returns a level outside h1–h6', () => {
    expect(clampHeadingLevel(0)).toBe(1)
    expect(clampHeadingLevel(-3)).toBe(1)
    expect(clampHeadingLevel(7)).toBe(6)
    expect(clampHeadingLevel(99)).toBe(6)
  })

  it('rounds a non-integer rather than emitting an invalid element', () => {
    expect(clampHeadingLevel(2.4)).toBe(2)
  })
})

describe('nextHeadingLevel', () => {
  it('descends one level', () => {
    expect(nextHeadingLevel(1)).toBe(2)
    expect(nextHeadingLevel(5)).toBe(6)
  })

  it('saturates at h6 instead of skipping to an invalid level', () => {
    // Deep nesting stops descending. Repeated h6 is a flat outline; an `h7` is invalid
    // markup, and an h6→h1 wrap would be an outright heading-order violation.
    expect(nextHeadingLevel(6)).toBe(6)
  })
})

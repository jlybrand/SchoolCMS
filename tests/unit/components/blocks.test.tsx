// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { BlockList } from '@/blocks'
import type { CallToActionBlock, PageBlock, RichTextPageBlock } from '@/content/types'

import { renderComponent } from '../../helpers/render'

/**
 * The block renderers (`03` §3).
 *
 * What is under test is the half of the conformance claim the schema cannot make: `03` §3.2
 * says "a block cannot produce a heading-order violation regardless of placement," and the
 * schema's contribution is only that no block HAS a heading-level field. These tests are the
 * other half — that the level actually rendered comes from the page outline, and that
 * reordering blocks does not change it.
 *
 * Semantics only. Contrast, focus appearance and RTL mirroring are checked by
 * `tests/a11y/storybook.spec.ts` in real Chromium, where they exist.
 */

const richText = (id: string, heading: string): RichTextPageBlock => ({
  kind: 'richText',
  id,
  content: [
    { kind: 'heading', level: 2, children: [{ kind: 'text', text: heading, marks: [] }] },
    { kind: 'paragraph', children: [{ kind: 'text', text: 'Body copy.', marks: [] }] },
  ],
})

const cta = (id: string, overrides: Partial<CallToActionBlock> = {}): CallToActionBlock => ({
  kind: 'callToAction',
  id,
  heading: 'Enroll for the fall',
  text: 'Registration closes on 15 August.',
  href: '/enroll',
  linkLabel: 'Start enrollment',
  newTab: false,
  ...overrides,
})

const levelsIn = (container: HTMLElement) =>
  [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => Number(el.tagName[1]))

describe('BlockList', () => {
  it('renders nothing for an empty layout', () => {
    const { container } = renderComponent(<BlockList blocks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders blocks in author order', () => {
    const blocks: PageBlock[] = [richText('a', 'First'), cta('b'), richText('c', 'Third')]
    const { container } = renderComponent(<BlockList blocks={blocks} />)

    const headings = [...container.querySelectorAll('h2')].map((el) => el.textContent)
    expect(headings).toEqual(['First', 'Enroll for the fall', 'Third'])
  })

  /**
   * THE CLAIM `03` §3.2 MAKES. Every block's own heading is the same level wherever it sits,
   * because the level is derived from the page outline rather than from position in the array.
   * Reordering is therefore not a way to produce a violation.
   */
  it('gives every block the same heading level regardless of order', () => {
    const forward = renderComponent(<BlockList blocks={[cta('a'), richText('b', 'Second')]} />)
    expect(levelsIn(forward.container)).toEqual([2, 2])

    const reversed = renderComponent(<BlockList blocks={[richText('b', 'Second'), cta('a')]} />)
    expect(levelsIn(reversed.container)).toEqual([2, 2])
  })

  /**
   * A layout nested inside a named region starts a step deeper, and the author's sub-headings
   * follow it down. Threaded as a prop because these are server components (`levels.ts`).
   */
  it('threads baseLevel into both the block heading and the author’s headings', () => {
    const nested: RichTextPageBlock = {
      kind: 'richText',
      id: 'a',
      content: [
        { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Top', marks: [] }] },
        { kind: 'heading', level: 3, children: [{ kind: 'text', text: 'Sub', marks: [] }] },
      ],
    }

    const { container } = renderComponent(<BlockList baseLevel={3} blocks={[nested, cta('b')]} />)
    expect(levelsIn(container)).toEqual([3, 4, 3])
  })

  /** Never `h1`: the page title owns it, so a block can never give the page a second. */
  it('clamps a base level that would collide with the page title', () => {
    const { container } = renderComponent(<BlockList baseLevel={1} blocks={[cta('a')]} />)
    expect(levelsIn(container)).toEqual([2])
  })
})

describe('CallToAction', () => {
  it('renders the button as a link, not a button element', () => {
    const { container } = renderComponent(<BlockList blocks={[cta('a')]} />)

    const action = container.querySelector('a[href="/enroll"]')
    expect(action).not.toBeNull()
    expect(action?.textContent).toContain('Start enrollment')
    expect(container.querySelector('button')).toBeNull()
  })

  /** WCAG 3.2.5 — `Link` owns the notice, so the block gets it by not reimplementing one. */
  it('announces a new window', () => {
    const { container } = renderComponent(<BlockList blocks={[cta('a', { newTab: true })]} />)

    const action = container.querySelector('a[href="/enroll"]')
    expect(action?.getAttribute('target')).toBe('_blank')
    expect(action?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(action?.textContent).toContain('opens in a new window')
  })

  it('renders without a heading or supporting line', () => {
    const bare = cta('a', { heading: null, text: null })
    const { container } = renderComponent(<BlockList blocks={[bare]} />)

    expect(levelsIn(container)).toEqual([])
    expect(container.querySelector('a[href="/enroll"]')).not.toBeNull()
  })
})

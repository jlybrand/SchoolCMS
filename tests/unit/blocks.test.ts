import { describe, expect, it } from 'vitest'

import { toPageBlocks } from '@/content/blocks'

/**
 * The Payload `layout` array -> DD2 block mapper (`02` §11, ADR-5, `03` §3).
 *
 * The same boundary as `rich-text.ts`, one level up: Payload's block rows carry `blockType`
 * discriminators and Lexical editor state, and every component downstream must see DD2
 * domain blocks instead. Test-first per CLAUDE.md — mappers are on the mandatory list.
 *
 * THE DEFENSIVE PROPERTY IS THE POINT. This runs at build and revalidate time across a
 * `layout` array whose shape changes every time a block is added, renamed, or removed from
 * the register (`03` §3.1). A block type this mapper does not recognise — one deleted from
 * the schema, or one from a future version rendered by an older deploy — must become
 * nothing. A build that throws on one unknown block takes twenty-eight sites with it.
 */

const lexical = (...children: unknown[]) => ({ root: { type: 'root', children } })
const paragraph = (value: string) => ({
  type: 'paragraph',
  children: [{ type: 'text', text: value, format: 0 }],
})

describe('toPageBlocks — shape', () => {
  it('returns an empty array for a page with no layout', () => {
    expect(toPageBlocks(undefined)).toEqual([])
    expect(toPageBlocks(null)).toEqual([])
    expect(toPageBlocks([])).toEqual([])
  })

  it('never throws on malformed input', () => {
    for (const value of ['string', 42, {}, [null], [42], [{}], [[]]]) {
      expect(() => toPageBlocks(value)).not.toThrow()
    }
  })

  it('preserves author order', () => {
    const result = toPageBlocks([
      { blockType: 'callToAction', id: 'a', href: '/one', linkLabel: 'One' },
      { blockType: 'richText', id: 'b', content: lexical(paragraph('Middle')) },
      { blockType: 'callToAction', id: 'c', href: '/two', linkLabel: 'Two' },
    ])
    expect(result.map((block) => block.id)).toEqual(['a', 'b', 'c'])
  })

  /**
   * The forward-compatibility case. A deploy rendering content authored against a newer
   * schema must drop what it cannot render and keep what it can, rather than failing the
   * build for the whole tenant.
   */
  it('drops an unrecognised block type and keeps its neighbours', () => {
    const result = toPageBlocks([
      { blockType: 'richText', id: 'a', content: lexical(paragraph('Before')) },
      { blockType: 'someBlockFromTheFuture', id: 'b', headline: 'Unknown' },
      { blockType: 'richText', id: 'c', content: lexical(paragraph('After')) },
    ])
    expect(result.map((block) => block.id)).toEqual(['a', 'c'])
  })

  /**
   * Ids come from Payload's array rows and are the render key. A row without one still has
   * to render — it is content — so an id is synthesised from position rather than dropping
   * the block or emitting a duplicate key.
   */
  it('synthesises an id when a row has none', () => {
    const result = toPageBlocks([
      { blockType: 'richText', content: lexical(paragraph('One')) },
      { blockType: 'richText', content: lexical(paragraph('Two')) },
    ])
    expect(result).toHaveLength(2)
    expect(new Set(result.map((block) => block.id)).size).toBe(2)
  })
})

describe('toPageBlocks — richText', () => {
  it('maps content through the rich-text mapper, not raw editor state', () => {
    const [block] = toPageBlocks([
      { blockType: 'richText', id: 'a', content: lexical(paragraph('Hello')) },
    ])
    expect(block).toEqual({
      kind: 'richText',
      id: 'a',
      content: [{ kind: 'paragraph', children: [{ kind: 'text', text: 'Hello', marks: [] }] }],
    })
  })

  /**
   * An empty rich-text block is dropped rather than rendered. `RichText` already returns
   * null for an empty document, so keeping it would put an addressable block in the layout
   * that renders nothing — invisible to the editor who left it there, and a gap in the
   * vertical rhythm the design system owns.
   */
  it('drops a block whose content is empty', () => {
    expect(toPageBlocks([{ blockType: 'richText', id: 'a', content: lexical() }])).toEqual([])
    expect(toPageBlocks([{ blockType: 'richText', id: 'a' }])).toEqual([])
  })
})

describe('toPageBlocks — callToAction', () => {
  it('maps a complete call to action', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'callToAction',
        id: 'a',
        heading: 'Enroll for the fall',
        text: 'Registration closes on 15 August.',
        href: '/enroll',
        linkLabel: 'Start enrollment',
        newTab: false,
      },
    ])
    expect(block).toEqual({
      kind: 'callToAction',
      id: 'a',
      heading: 'Enroll for the fall',
      text: 'Registration closes on 15 August.',
      href: '/enroll',
      linkLabel: 'Start enrollment',
      newTab: false,
    })
  })

  /**
   * The link IS the block. Without a destination there is nothing to call the reader to, and
   * a button-shaped element that goes nowhere is the failure `rich-text.ts` unwraps
   * href-less anchors to avoid — it looks actionable, is unfocusable, and announces nothing.
   */
  it('drops a call to action with no destination', () => {
    const rows = [
      { blockType: 'callToAction', id: 'a', linkLabel: 'Go' },
      { blockType: 'callToAction', id: 'b', href: '   ', linkLabel: 'Go' },
    ]
    expect(toPageBlocks(rows)).toEqual([])
  })

  /**
   * WCAG 2.4.4 — a link's accessible name is what tells the reader where it goes. An unnamed
   * one is announced as "link" and nothing else, so it is dropped rather than rendered with
   * the URL as its label.
   */
  it('drops a call to action with no link label', () => {
    const rows = [
      { blockType: 'callToAction', id: 'a', href: '/enroll' },
      { blockType: 'callToAction', id: 'b', href: '/enroll', linkLabel: '  ' },
    ]
    expect(toPageBlocks(rows)).toEqual([])
  })

  /**
   * Heading and body text are optional in the domain even though the schema asks for a
   * heading: the words are the content and they survive, per `rich-text.ts`. A CTA that
   * lost its heading still renders its link rather than vanishing.
   */
  it('renders without a heading or body text', () => {
    const [block] = toPageBlocks([
      { blockType: 'callToAction', id: 'a', href: '/enroll', linkLabel: 'Enroll' },
    ])
    expect(block).toMatchObject({ heading: null, text: null, newTab: false })
  })

  it('trims surrounding whitespace', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'callToAction',
        id: 'a',
        heading: '  Enroll  ',
        href: '  /enroll  ',
        linkLabel: '  Start  ',
      },
    ])
    expect(block).toMatchObject({ heading: 'Enroll', href: '/enroll', linkLabel: 'Start' })
  })

  it('carries newTab through so the renderer can announce it', () => {
    const [block] = toPageBlocks([
      { blockType: 'callToAction', id: 'a', href: 'https://x.test', linkLabel: 'Go', newTab: true },
    ])
    expect(block).toMatchObject({ newTab: true })
  })
})

/**
 * THE COUPLING BETWEEN THE TWO HALVES OF A BLOCK.
 *
 * A block is declared in `src/collections/blocks/` and rendered from `src/blocks/`, joined
 * only by the `blockType` string the mapper switches on. Nothing about that join is checked
 * by the compiler: the mapper's keys are string literals, so renaming a block's `slug` leaves
 * every other test in this file passing while the block silently stops rendering — present in
 * the admin, saved in the database, absent from the published page.
 *
 * These tests are that check. They import the real schema rather than restating it, so the
 * two halves cannot drift apart without one failing.
 */
describe('the block library and the mapper agree', () => {
  it('renders a complete row for every block type in the schema', async () => {
    const { blockLibrary } = await import('@/collections/blocks')

    /** One complete row per block slug. A new block with no entry here fails the next test. */
    const COMPLETE: Record<string, Record<string, unknown>> = {
      richText: { content: lexical(paragraph('Words')) },
      callToAction: { href: '/enroll', linkLabel: 'Enroll' },
    }

    for (const block of blockLibrary) {
      const fixture = COMPLETE[block.slug]
      expect(fixture, `no complete fixture for block "${block.slug}"`).toBeDefined()

      const result = toPageBlocks([{ blockType: block.slug, id: block.slug, ...fixture }])
      expect(result, `block "${block.slug}" is declared but not mapped`).toHaveLength(1)
    }
  })
})

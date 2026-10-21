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
   * The same allowlist the menus use (`src/lib/href.ts`). The admin validates the field, but
   * a migration or a direct database write only has to get past one of the two checks — so the
   * mapper does not trust that the validator ran. A call to action whose destination is not
   * one of the four accepted shapes has no safe link to be, and the link is the block.
   */
  it.each([['javascript:alert(1)'], ['//evil.example/enroll'], ['enroll'], ['data:text/html,x']])(
    'drops a call to action whose destination is %j',
    (href) => {
      expect(toPageBlocks([{ blockType: 'callToAction', id: 'a', href, linkLabel: 'Go' }])).toEqual(
        [],
      )
    },
  )

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

describe('toPageBlocks — accordion', () => {
  const item = (heading: string, body: string) => ({
    heading,
    content: lexical(paragraph(body)),
  })

  it('maps items in order', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'accordion',
        id: 'a',
        heading: 'Common questions',
        items: [item('When does the bus run?', 'From 6:45 a.m.'), item('Where?', 'Main lot.')],
      },
    ])

    expect(block).toMatchObject({ kind: 'accordion', heading: 'Common questions' })
    expect(block?.kind === 'accordion' && block.items.map((i) => i.heading)).toEqual([
      'When does the bus run?',
      'Where?',
    ])
  })

  /**
   * A disclosure whose question is blank is an unlabelled control, and one whose answer is
   * blank opens onto nothing. Both are dropped rather than rendered — the same reasoning as a
   * call to action with no destination.
   */
  it('drops an item with no heading or no content', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'accordion',
        id: 'a',
        items: [
          item('Kept', 'Answer.'),
          { heading: '  ', content: lexical(paragraph('Orphan answer.')) },
          { heading: 'No answer', content: lexical() },
        ],
      },
    ])
    expect(block?.kind === 'accordion' && block.items.map((i) => i.heading)).toEqual(['Kept'])
  })

  it('drops the block when no item survives', () => {
    expect(toPageBlocks([{ blockType: 'accordion', id: 'a', items: [] }])).toEqual([])
    expect(toPageBlocks([{ blockType: 'accordion', id: 'a' }])).toEqual([])
  })

  it('keeps the block without its own heading', () => {
    const [block] = toPageBlocks([{ blockType: 'accordion', id: 'a', items: [item('Q', 'A')] }])
    expect(block).toMatchObject({ heading: null })
  })
})

describe('toPageBlocks — cardGrid', () => {
  it('maps cards in order', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'cardGrid',
        id: 'a',
        heading: 'Programs',
        cards: [
          { title: 'Athletics', text: 'Fall sign-ups are open.', href: '/athletics' },
          { title: 'Arts' },
        ],
      },
    ])

    expect(block).toMatchObject({ kind: 'cardGrid', heading: 'Programs' })
    expect(block?.kind === 'cardGrid' && block.cards).toEqual([
      { title: 'Athletics', text: 'Fall sign-ups are open.', href: '/athletics' },
      { title: 'Arts', text: null, href: null },
    ])
  })

  /** The title is the card's name. Without one there is nothing to announce or link. */
  it('drops a card with no title', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'cardGrid',
        id: 'a',
        cards: [{ title: 'Kept' }, { text: 'Orphan blurb', href: '/x' }, { title: '  ' }],
      },
    ])
    expect(block?.kind === 'cardGrid' && block.cards.map((c) => c.title)).toEqual(['Kept'])
  })

  /**
   * Unlike a call to action, a card is content without its link — `href` is optional, and a
   * card can be a labelled fact. So an unsafe destination costs the card its link, not the
   * card: the words survive, per `rich-text.ts`, and the `javascript:` does not.
   */
  it('keeps a card whose destination is unsafe, without the link', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'cardGrid',
        id: 'a',
        cards: [
          { title: 'Script', href: 'javascript:alert(1)' },
          { title: 'Elsewhere', href: '//evil.example/x' },
          { title: 'Portal', href: '  https://portal.example/  ' },
        ],
      },
    ])
    expect(block?.kind === 'cardGrid' && block.cards.map((c) => c.href)).toEqual([
      null,
      null,
      'https://portal.example/',
    ])
  })

  it('drops the block when no card survives', () => {
    expect(toPageBlocks([{ blockType: 'cardGrid', id: 'a', cards: [] }])).toEqual([])
  })
})

describe('toPageBlocks — divider', () => {
  /**
   * The only block with no content to validate, so the only one that cannot be dropped for
   * being empty. It still needs an id, which is what the row supplies.
   */
  it('always survives', () => {
    expect(toPageBlocks([{ blockType: 'divider', id: 'a' }])).toEqual([
      { kind: 'divider', id: 'a' },
    ])
  })
})

describe('toPageBlocks — childPageNav', () => {
  /**
   * THE ONLY BLOCK WHOSE EMPTINESS THIS MAPPER CANNOT JUDGE.
   *
   * Every other block is dropped here when it has nothing to show, because everything it
   * shows is in its own row. A section menu's content is the page's children, which live in
   * other rows and are resolved by `src/content/pages.ts` — so the mapper cannot know whether
   * this one is empty, and the renderer owns the drop instead (see `src/blocks/ChildPageNav`).
   */
  it('survives with no fields of its own', () => {
    expect(toPageBlocks([{ blockType: 'childPageNav', id: 'a' }])).toEqual([
      { kind: 'childPageNav', id: 'a', heading: null },
    ])
  })

  it('carries its heading through', () => {
    const [block] = toPageBlocks([
      { blockType: 'childPageNav', id: 'a', heading: '  In this section  ' },
    ])
    expect(block).toEqual({ kind: 'childPageNav', id: 'a', heading: 'In this section' })
  })

  /**
   * No `children` field on the domain block, deliberately. The pages come from the page being
   * rendered and are threaded through `BlockList` as a prop — putting them on the block would
   * make this mapper need page context, which is what keeps it a pure function over JSON and
   * therefore reusable by the Phase 9 migration mappers (`10` §5).
   */
  it('never carries the child pages themselves', () => {
    const [block] = toPageBlocks([
      { blockType: 'childPageNav', id: 'a', children: [{ title: 'Injected', path: '/nope' }] },
    ])
    expect(Object.keys(block ?? {}).sort()).toEqual(['heading', 'id', 'kind'])
  })
})

describe('toPageBlocks — embed', () => {
  const ID = 'dQw4w9WgXcQ'

  it('normalizes the pasted URL rather than storing it', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'embed',
        id: 'a',
        url: `https://youtu.be/${ID}?t=30`,
        title: 'Board meeting, 12 August 2026',
      },
    ])

    expect(block).toEqual({
      kind: 'embed',
      id: 'a',
      src: `https://www.youtube-nocookie.com/embed/${ID}?start=30`,
      href: `https://www.youtube.com/watch?v=${ID}`,
      title: 'Board meeting, 12 August 2026',
    })
  })

  /**
   * The block never carries the editor's string. `src` and `href` are built by
   * `src/lib/embed-url.ts` from constants — the allowlist applies to what is rendered, not to
   * what was typed (`02` §7, `07` §6).
   */
  it('never carries the raw url through to the renderer', () => {
    const [block] = toPageBlocks([
      { blockType: 'embed', id: 'a', url: `https://www.youtube.com/watch?v=${ID}`, title: 'T' },
    ])
    expect(Object.keys(block ?? {}).sort()).toEqual(['href', 'id', 'kind', 'src', 'title'])
  })

  /**
   * A frame pointing somewhere the district has not allowlisted is dropped, not rendered
   * empty. `07` §6 makes an embed DD2's accessibility obligation, and a vendor needs a current
   * VPAT before it can be one — so an unknown host is a policy failure, not a typo to display.
   */
  it('drops an embed whose host is not allowlisted', () => {
    const rows = [
      { blockType: 'embed', id: 'a', url: 'https://vimeo.com/123456789', title: 'T' },
      {
        blockType: 'embed',
        id: 'b',
        url: 'https://youtube.com.evil.test/watch?v=' + ID,
        title: 'T',
      },
      { blockType: 'embed', id: 'c', title: 'T' },
    ]
    expect(toPageBlocks(rows)).toEqual([])
  })

  /**
   * `07` §6 requires a title on every embed. Without one the frame is announced as "frame" and
   * nothing else, and a screen-reader user cannot tell what it holds — the same reasoning that
   * drops an unlabelled call to action (WCAG 4.1.2).
   */
  it('drops an embed with no title', () => {
    const rows = [
      { blockType: 'embed', id: 'a', url: `https://youtu.be/${ID}` },
      { blockType: 'embed', id: 'b', url: `https://youtu.be/${ID}`, title: '   ' },
    ]
    expect(toPageBlocks(rows)).toEqual([])
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
      accordion: { items: [{ heading: 'Q', content: lexical(paragraph('A')) }] },
      cardGrid: { cards: [{ title: 'Card' }] },
      childPageNav: {},
      embed: { url: 'https://youtu.be/dQw4w9WgXcQ', title: 'A video' },
      divider: {},
    }

    for (const block of blockLibrary) {
      const fixture = COMPLETE[block.slug]
      expect(fixture, `no complete fixture for block "${block.slug}"`).toBeDefined()

      const result = toPageBlocks([{ blockType: block.slug, id: block.slug, ...fixture }])
      expect(result, `block "${block.slug}" is declared but not mapped`).toHaveLength(1)
    }
  })
})

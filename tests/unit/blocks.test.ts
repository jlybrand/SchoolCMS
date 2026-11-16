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
/**
 * A news feed (Jason, 2026-10-28) — its SETTINGS only. The announcements are loaded by the
 * resolve pass (`src/content/resolve-blocks.ts`); this mapper stays pure so the migration can run
 * it with no CMS (`10` §5).
 */
describe('toPageBlocks — feed', () => {
  it('maps the heading, the boards, the tags and how many', () => {
    expect(
      toPageBlocks([
        {
          blockType: 'feed',
          id: 'f',
          heading: ' District news ',
          boards: [7, { id: 8, title: 'x' }],
          tags: [{ id: 3 }],
          limit: 4,
        },
      ]),
    ).toEqual([
      {
        kind: 'feed',
        id: 'f',
        heading: 'District news',
        boards: ['7', '8'],
        tags: ['3'],
        limit: 4,
      },
    ])
  })

  it('no tags is no tag filter; no heading is null; the count defaults to 5', () => {
    expect(toPageBlocks([{ blockType: 'feed', id: 'f', boards: [7] }])).toEqual([
      { kind: 'feed', id: 'f', heading: null, boards: ['7'], tags: [], limit: 5 },
    ])
  })

  it.each([
    [0, 1],
    [-3, 1],
    [50, 10],
    [3.7, 3],
    ['4', 5],
  ])('keeps the count between 1 and 10 (%s → %s)', (limit, expected) => {
    const [block] = toPageBlocks([{ blockType: 'feed', id: 'f', boards: [7], limit }])
    expect(block).toMatchObject({ limit: expected })
  })

  it('a feed with no boards is DROPPED — it would mean "every board", which nobody chose', () => {
    expect(toPageBlocks([{ blockType: 'feed', id: 'f', boards: [] }])).toEqual([])
    expect(toPageBlocks([{ blockType: 'feed', id: 'f' }])).toEqual([])
  })
})

/**
 * A calendar (Jason, 2026-11-11) — its SETTINGS only, as for a feed. The events are loaded by the
 * resolve pass. Grid or list; a list has a number of events.
 */
describe('toPageBlocks — calendar', () => {
  it('maps the heading, the calendars, the view and how many', () => {
    expect(
      toPageBlocks([
        {
          blockType: 'calendar',
          id: 'c',
          heading: ' What’s on ',
          calendars: [4, { id: 5, label: 'District · District HS' }],
          display: 'list',
          limit: 8,
        },
      ]),
    ).toEqual([
      {
        kind: 'calendar',
        id: 'c',
        heading: 'What’s on',
        calendars: ['4', '5'],
        display: 'list',
        limit: 8,
      },
    ])
  })

  it('a grid; no heading is null; the view defaults to a list of 5', () => {
    expect(
      toPageBlocks([{ blockType: 'calendar', id: 'c', calendars: [4], display: 'grid' }]),
    ).toEqual([
      { kind: 'calendar', id: 'c', heading: null, calendars: ['4'], display: 'grid', limit: 5 },
    ])
    expect(
      toPageBlocks([{ blockType: 'calendar', id: 'c', calendars: [4], display: 'x' }]),
    ).toEqual([
      { kind: 'calendar', id: 'c', heading: null, calendars: ['4'], display: 'list', limit: 5 },
    ])
  })

  it.each([
    [0, 1],
    [80, 50],
    [3.7, 3],
    ['4', 5],
  ])('keeps the count between 1 and 50 (%s → %s)', (limit, expected) => {
    const [block] = toPageBlocks([{ blockType: 'calendar', id: 'c', calendars: [4], limit }])
    expect(block).toMatchObject({ limit: expected })
  })

  it('a calendar block with no calendars is DROPPED — nobody chose what it shows', () => {
    expect(toPageBlocks([{ blockType: 'calendar', id: 'c', calendars: [] }])).toEqual([])
    expect(toPageBlocks([{ blockType: 'calendar', id: 'c' }])).toEqual([])
  })
})

/**
 * Columns (Jason, 2026-11-04): two or three columns, each holding other blocks. Nesting is
 * allowed; the heading levels inside follow from where the column sits (`columnLevels`), so the
 * district cannot produce a skipped level by placing blocks.
 */
describe('toPageBlocks — columns', () => {
  const text = (value: string) => ({ blockType: 'richText', content: lexical(paragraph(value)) })

  it('maps each column’s heading and its blocks, in order', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'columns',
        id: 'c1',
        heading: 'Get involved',
        columns: [
          { id: 'a', heading: 'Volunteer', content: [text('Help in class')] },
          { id: 'b', content: [text('Join the PTA'), { blockType: 'divider', id: 'd' }] },
        ],
      },
    ])
    expect(block).toMatchObject({ kind: 'columns', id: 'c1', heading: 'Get involved' })
    expect(block?.kind === 'columns' && block.columns.map((c) => c.heading)).toEqual([
      'Volunteer',
      null,
    ])
    expect(
      block?.kind === 'columns' && block.columns.map((c) => c.blocks.map((b) => b.kind)),
    ).toEqual([['richText'], ['richText', 'divider']])
  })

  it('keeps an empty column, so the others stay where the district put them', () => {
    const [block] = toPageBlocks([
      { blockType: 'columns', id: 'c', columns: [{ content: [text('Only')] }, { content: [] }] },
    ])
    expect(block?.kind === 'columns' && block.columns.length).toBe(2)
  })

  it('drops columns with nothing in any of them', () => {
    expect(
      toPageBlocks([
        { blockType: 'columns', id: 'c', columns: [{ content: [] }, { content: [] }] },
      ]),
    ).toEqual([])
    expect(toPageBlocks([{ blockType: 'columns', id: 'c', columns: [] }])).toEqual([])
  })

  it('maps blocks inside a column as it maps them anywhere — an unknown one becomes nothing', () => {
    const [block] = toPageBlocks([
      {
        blockType: 'columns',
        id: 'c',
        columns: [{ content: [text('Kept'), { blockType: 'retired', id: 'x' }] }, { content: [] }],
      },
    ])
    expect(block?.kind === 'columns' && block.columns[0]?.blocks.map((b) => b.kind)).toEqual([
      'richText',
    ])
  })

  it('takes at most three columns', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ content: [text(String(i))] }))
    const [block] = toPageBlocks([{ blockType: 'columns', id: 'c', columns: many }])
    expect(block?.kind === 'columns' && block.columns.length).toBe(3)
  })
})

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
      feed: { boards: [7] },
      calendar: { calendars: [4] },
      staffList: { group: 7 },
      image: { image: 12 },
      hero: { image: 12 },
      columns: {
        columns: [
          { content: [{ blockType: 'richText', content: lexical(paragraph('One')) }] },
          { content: [{ blockType: 'richText', content: lexical(paragraph('Two')) }] },
        ],
      },
    }

    for (const block of blockLibrary) {
      const fixture = COMPLETE[block.slug]
      expect(fixture, `no complete fixture for block "${block.slug}"`).toBeDefined()

      const result = toPageBlocks([{ blockType: block.slug, id: block.slug, ...fixture }])
      expect(result, `block "${block.slug}" is declared but not mapped`).toHaveLength(1)
    }
  })
})

/**
 * Buttons and cards that point at a PAGE (Jason, 2026-10-29) store the page and take its path
 * today, as menu links do. A row saved before link types existed reads as an address.
 */
describe('toPageBlocks — links to a page', () => {
  const paths = new Map([['5', '/enroll']])
  const cta = (extra: Record<string, unknown>) => ({
    blockType: 'callToAction',
    id: 'c',
    heading: 'Enroll',
    linkLabel: 'Start enrollment',
    ...extra,
  })

  it("points a call to action at the page's current path", () => {
    const [block] = toPageBlocks([cta({ linkType: 'page', page: 5, href: '/stale' })], paths)
    expect(block).toMatchObject({ kind: 'callToAction', href: '/enroll' })
  })

  it('drops a call to action whose page has no current path — a button that goes nowhere', () => {
    expect(toPageBlocks([cta({ linkType: 'page', page: 99 })], paths)).toEqual([])
    expect(toPageBlocks([cta({ linkType: 'page', page: 5 })])).toEqual([])
  })

  it('keeps a call to action saved before link types existed', () => {
    const [block] = toPageBlocks([cta({ href: '/apply' })], paths)
    expect(block).toMatchObject({ href: '/apply' })
  })

  const cards = (...rows: Record<string, unknown>[]) => [
    {
      blockType: 'cardGrid',
      id: 'g',
      cards: rows.map((row, i) => ({ title: `Card ${i}`, ...row })),
    },
  ]
  const hrefs = (blocks: ReturnType<typeof toPageBlocks>) =>
    blocks[0]?.kind === 'cardGrid' ? blocks[0].cards.map((card) => card.href) : null

  it('links a card to a page, an address, or nothing', () => {
    const result = toPageBlocks(
      cards(
        { linkType: 'page', page: 5 },
        { linkType: 'address', href: '/athletics' },
        { linkType: 'none', href: '/ignored' },
        { href: '/legacy' },
        {},
      ),
      paths,
    )
    expect(hrefs(result)).toEqual(['/enroll', '/athletics', null, '/legacy', null])
  })

  it('keeps a card whose page has no current path, without its link', () => {
    expect(hrefs(toPageBlocks(cards({ linkType: 'page', page: 99 }), paths))).toEqual([null])
  })

  it('resolves page links in the words of a text block and an accordion', () => {
    const words = lexical({
      type: 'paragraph',
      children: [
        {
          type: 'link',
          fields: { linkType: 'internal', doc: { relationTo: 'pages', value: 5 } },
          children: [{ type: 'text', text: 'Enroll', format: 0 }],
        },
      ],
    })
    const [text, accordion] = toPageBlocks(
      [
        { blockType: 'richText', id: 't', content: words },
        { blockType: 'accordion', id: 'a', items: [{ heading: 'How?', content: words }] },
      ],
      paths,
    )
    expect(JSON.stringify(text)).toContain('"href":"/enroll"')
    expect(JSON.stringify(accordion)).toContain('"href":"/enroll"')
  })
})

/**
 * A staff list (Jason, 2026-11-13) — its SETTINGS only: the group or sub-group it shows. The
 * staff are loaded by the resolve pass (`listStaff`), as a calendar's events are.
 */
describe('toPageBlocks — staff list', () => {
  it('maps the heading and the group, by id', () => {
    expect(
      toPageBlocks([
        { blockType: 'staffList', id: 's', heading: '  Our counselors ', group: { id: 7 } },
      ]),
    ).toEqual([
      { kind: 'staffList', id: 's', heading: 'Our counselors', group: '7', maxColumns: 3 },
    ])
    expect(toPageBlocks([{ blockType: 'staffList', id: 's', group: 7 }])).toEqual([
      { kind: 'staffList', id: 's', heading: null, group: '7', maxColumns: 3 },
    ])
  })

  // Jason, 2026-11-13: "a maximum of n columns, whether there is one staff member or 500".
  it('the most people side by side: 1 to 4, 3 unless set, anything else 3', () => {
    const max = (maxColumns: unknown) =>
      (
        toPageBlocks([{ blockType: 'staffList', id: 's', group: 7, maxColumns }])[0] as {
          maxColumns: number
        }
      ).maxColumns
    expect([max('1'), max('2'), max('3'), max('4')]).toEqual([1, 2, 3, 4])
    expect([max(1), max(4)]).toEqual([1, 4])
    expect([max(undefined), max(null), max('5'), max('0'), max('two')]).toEqual([3, 3, 3, 3, 3])
  })

  it('a staff list with no group is DROPPED — nobody chose whose staff', () => {
    expect(toPageBlocks([{ blockType: 'staffList', id: 's' }])).toEqual([])
    expect(toPageBlocks([{ blockType: 'staffList', id: 's', group: null }])).toEqual([])
  })
})

/**
 * An image and a hero (Jason, 2026-11-13) — their SETTINGS: the library file they show, by id.
 * The image itself (address, sizes, alt) is loaded by the resolve pass. No image: dropped.
 */
describe('toPageBlocks — image', () => {
  it('maps the file and the caption', () => {
    expect(
      toPageBlocks([{ blockType: 'image', id: 'i', image: { id: 12 }, caption: '  The gym  ' }]),
    ).toEqual([{ kind: 'image', id: 'i', image: '12', caption: 'The gym' }])
    expect(toPageBlocks([{ blockType: 'image', id: 'i', image: 12 }])).toEqual([
      { kind: 'image', id: 'i', image: '12', caption: null },
    ])
  })

  it('no image chosen: dropped', () => {
    expect(toPageBlocks([{ blockType: 'image', id: 'i', caption: 'x' }])).toEqual([])
  })
})

describe('toPageBlocks — hero', () => {
  it('an image alone is a hero — the words are optional (Jason)', () => {
    expect(toPageBlocks([{ blockType: 'hero', id: 'h', image: 12 }])).toEqual([
      {
        kind: 'hero',
        id: 'h',
        image: '12',
        heading: null,
        subheading: null,
        href: null,
        linkLabel: null,
        newTab: false,
      },
    ])
  })

  it('with a heading, a subheading and a button', () => {
    expect(
      toPageBlocks([
        {
          blockType: 'hero',
          id: 'h',
          image: 12,
          heading: ' Welcome ',
          subheading: 'Home of the Hawks',
          linkType: 'address',
          href: '/enroll',
          linkLabel: 'Start enrollment',
          newTab: true,
        },
      ]),
    ).toEqual([
      {
        kind: 'hero',
        id: 'h',
        image: '12',
        heading: 'Welcome',
        subheading: 'Home of the Hawks',
        href: '/enroll',
        linkLabel: 'Start enrollment',
        newTab: true,
      },
    ])
  })

  it('a button needs both its address and its words, or there is none', () => {
    const [noWords] = toPageBlocks([
      { blockType: 'hero', id: 'h', image: 12, linkType: 'address', href: '/enroll' },
    ])
    expect(noWords).toMatchObject({ href: null, linkLabel: null })
    const [nothing] = toPageBlocks([
      { blockType: 'hero', id: 'h', image: 12, linkType: 'none', linkLabel: 'Go' },
    ])
    expect(nothing).toMatchObject({ href: null, linkLabel: null })
  })

  it('no image: dropped', () => {
    expect(toPageBlocks([{ blockType: 'hero', id: 'h', heading: 'Welcome' }])).toEqual([])
  })
})

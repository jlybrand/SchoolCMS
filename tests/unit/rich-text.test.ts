import { describe, expect, it } from 'vitest'

import { toRichText } from '@/content/rich-text'

/**
 * The Lexical -> DD2 rich-text mapper (`02` §11, ADR-5).
 *
 * This is the boundary in its most literal form: Lexical's editor state is Payload's
 * internal representation, and every component downstream must see DD2 domain nodes
 * instead. Swapping the CMS should mean rewriting this file, not the renderer.
 *
 * Test-first per CLAUDE.md — mappers are named in the mandatory list.
 *
 * THE PROPERTY THAT MATTERS MOST IS THE DEFENSIVE ONE. This runs at build and revalidate
 * time over content authored years apart, including content migrated from Finalsite
 * (`10` §5) and content written before the editor was constrained. It must never throw: a
 * malformed node has to become "nothing" rather than a failed build, because a build that
 * fails on one bad page takes down twenty-eight sites.
 */

const text = (value: string, format = 0) => ({ type: 'text', text: value, format })
const root = (...children: unknown[]) => ({ root: { type: 'root', children } })

describe('toRichText — blocks', () => {
  it('maps a paragraph', () => {
    expect(toRichText(root({ type: 'paragraph', children: [text('Hello')] }))).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Hello', marks: [] }] },
    ])
  })

  it('maps h2 and h3 to their levels', () => {
    const result = toRichText(
      root(
        { type: 'heading', tag: 'h2', children: [text('Section')] },
        { type: 'heading', tag: 'h3', children: [text('Sub')] },
      ),
    )
    expect(result.map((b) => (b.kind === 'heading' ? b.level : null))).toEqual([2, 3])
  })

  it('DROPS an h1 rather than rendering it', () => {
    /**
     * The editor cannot produce one (`src/lib/editor.ts` enables h2/h3 only), but migrated
     * content can. A second `h1` is a heading-order violation on a page whose title already
     * owns level 1, so it is dropped rather than demoted — silently demoting would move
     * content into a hierarchy the author never chose.
     */
    expect(toRichText(root({ type: 'heading', tag: 'h1', children: [text('Nope')] }))).toEqual([])
  })

  it('maps an unordered list', () => {
    const result = toRichText(
      root({
        type: 'list',
        listType: 'bullet',
        children: [
          { type: 'listitem', children: [text('One')] },
          { type: 'listitem', children: [text('Two')] },
        ],
      }),
    )
    expect(result).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          { children: [{ kind: 'text', text: 'One', marks: [] }], list: null },
          { children: [{ kind: 'text', text: 'Two', marks: [] }], list: null },
        ],
      },
    ])
  })

  it('maps an ordered list', () => {
    const result = toRichText(
      root({
        type: 'list',
        listType: 'number',
        children: [{ type: 'listitem', children: [text('First')] }],
      }),
    )
    expect(result[0]).toMatchObject({ kind: 'list', ordered: true })
  })

  it('preserves a nested list rather than flattening it', () => {
    // Flattening would turn two levels of meaning into one. Agendas nest.
    const result = toRichText(
      root({
        type: 'list',
        listType: 'bullet',
        children: [
          {
            type: 'listitem',
            children: [
              text('Parent'),
              {
                type: 'list',
                listType: 'bullet',
                children: [{ type: 'listitem', children: [text('Child')] }],
              },
            ],
          },
        ],
      }),
    )

    expect(result).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            children: [{ kind: 'text', text: 'Parent', marks: [] }],
            list: {
              kind: 'list',
              ordered: false,
              items: [{ children: [{ kind: 'text', text: 'Child', marks: [] }], list: null }],
            },
          },
        ],
      },
    ])
  })

  it('drops an empty paragraph', () => {
    // Word pastes are full of spacer paragraphs. They are vertical rhythm expressed as
    // content, and the design system owns spacing.
    expect(toRichText(root({ type: 'paragraph', children: [] }))).toEqual([])
  })

  it('drops a paragraph of only whitespace', () => {
    expect(toRichText(root({ type: 'paragraph', children: [text('   ')] }))).toEqual([])
  })
})

describe('toRichText — inline marks', () => {
  it('maps bold and italic from the format bitmask', () => {
    const result = toRichText(
      root({
        type: 'paragraph',
        children: [text('b', 1), text('i', 2), text('bi', 3)],
      }),
    )
    const marks = result[0]?.kind === 'paragraph' ? result[0].children.map((c) => c) : []
    expect(marks).toEqual([
      { kind: 'text', text: 'b', marks: ['strong'] },
      { kind: 'text', text: 'i', marks: ['em'] },
      { kind: 'text', text: 'bi', marks: ['strong', 'em'] },
    ])
  })

  it('DROPS marks outside the allowlist instead of passing them through', () => {
    /**
     * Format 4 is strikethrough and 8 is underline — both denied in `src/lib/editor.ts`
     * (`07` §4.4). The editor cannot produce them, but migrated content can, and a mapper
     * that passed unknown marks through would reintroduce exactly the appearance-as-meaning
     * formatting the allowlist exists to prevent. The TEXT survives; only the styling goes.
     */
    const result = toRichText(root({ type: 'paragraph', children: [text('struck', 4 | 8)] }))
    expect(result).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'struck', marks: [] }] },
    ])
  })

  it('maps a link with its text', () => {
    const result = toRichText(
      root({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            fields: { url: 'https://dd2.example/handbook', newTab: false },
            children: [text('Handbook')],
          },
        ],
      }),
    )
    expect(result).toEqual([
      {
        kind: 'paragraph',
        children: [
          {
            kind: 'link',
            href: 'https://dd2.example/handbook',
            newTab: false,
            children: [{ kind: 'text', text: 'Handbook', marks: [] }],
          },
        ],
      },
    ])
  })

  it('drops a link with no destination but keeps its text', () => {
    // An anchor with no href is not a link — it is unfocusable, unannounced, and looks
    // clickable. The words still matter, so they survive as plain text.
    const result = toRichText(
      root({
        type: 'paragraph',
        children: [{ type: 'link', fields: {}, children: [text('Somewhere')] }],
      }),
    )
    expect(result).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Somewhere', marks: [] }] },
    ])
  })

  it('carries newTab through so the renderer can announce it', () => {
    const result = toRichText(
      root({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            fields: { url: 'https://example.org', newTab: true },
            children: [text('Out')],
          },
        ],
      }),
    )
    expect(result[0]).toMatchObject({ children: [{ kind: 'link', newTab: true }] })
  })

  /**
   * A link's own screen-reader words (Jason, 2026-11-19), held to WCAG 2.5.3 HERE too — the
   * renderer's guarantee, whatever the stored value: kept only when it adds to the link's words
   * and contains them.
   */
  const labelled = (ariaLabel: string, words: string) =>
    toRichText(
      root({
        type: 'paragraph',
        children: [{ type: 'link', fields: { url: '/bond', ariaLabel }, children: [text(words)] }],
      }),
    )[0]

  it('carries a link label that adds to the words and contains them', () => {
    expect(labelled('Read more about the bond election', 'Read more')).toMatchObject({
      children: [{ kind: 'link', ariaLabel: 'Read more about the bond election' }],
    })
  })

  it('drops a label that repeats the words, or leaves them out', () => {
    for (const label of ['read more', 'Bond details', '']) {
      const link = (labelled(label, 'Read more') as { children: Record<string, unknown>[] })
        .children[0]!
      expect(link).not.toHaveProperty('ariaLabel')
    }
  })
})

describe('toRichText — malformed input never throws', () => {
  /**
   * Every case here is something that could reach a build from migrated content. The bar is
   * the same throughout: drop what cannot be understood, keep what can, never throw. A
   * build that dies on one bad page takes twenty-eight sites with it.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['a string', 'not lexical at all'],
    ['a number', 42],
    ['a missing root', { root: null }],
    ['a root with no children', { root: { type: 'root' } }],
    ['children that are not an array', { root: { type: 'root', children: 'nope' } }],
  ])('returns an empty document for %s', (_label, input) => {
    expect(toRichText(input)).toEqual([])
  })

  it('skips an unknown node type and keeps its siblings', () => {
    const result = toRichText(
      root(
        { type: 'paragraph', children: [text('Before')] },
        { type: 'some-future-node', children: [text('???')] },
        { type: 'paragraph', children: [text('After')] },
      ),
    )
    expect(result).toHaveLength(2)
    expect(result.map((b) => (b.kind === 'paragraph' ? b.children[0] : null))).toEqual([
      { kind: 'text', text: 'Before', marks: [] },
      { kind: 'text', text: 'After', marks: [] },
    ])
  })

  it('skips a malformed child inside a valid paragraph', () => {
    const result = toRichText(
      root({ type: 'paragraph', children: [text('Keep'), null, 7, { type: 'text' }] }),
    )
    expect(result).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', text: 'Keep', marks: [] }] },
    ])
  })

  it('handles a heading with an unrecognised tag by dropping it', () => {
    expect(toRichText(root({ type: 'heading', tag: 'h7', children: [text('?')] }))).toEqual([])
  })

  it('handles a list with no items', () => {
    expect(toRichText(root({ type: 'list', listType: 'bullet', children: [] }))).toEqual([])
  })
})

/**
 * A link in the words to a PAGE on the site (Jason, 2026-10-29) — the editor's "internal link".
 * It stores the page, and takes the path the page has today, so renaming or moving the page
 * never breaks it. Before this, the mapper read only typed addresses and turned these back
 * into plain words.
 */
describe('toRichText — links to a page', () => {
  const paths = new Map([
    ['5', '/about/staff'],
    ['6', '/'],
  ])
  const internal = (doc: unknown, words = 'Our staff') =>
    root({
      type: 'paragraph',
      children: [
        {
          type: 'link',
          fields: { linkType: 'internal', doc, newTab: false },
          children: [text(words)],
        },
      ],
    })
  const linkOf = (result: ReturnType<typeof toRichText>) => {
    const block = result[0]
    return block?.kind === 'paragraph' ? block.children[0] : undefined
  }

  it("uses the page's current path", () => {
    expect(linkOf(toRichText(internal({ relationTo: 'pages', value: 5 }), paths))).toEqual({
      kind: 'link',
      href: '/about/staff',
      newTab: false,
      children: [{ kind: 'text', text: 'Our staff', marks: [] }],
    })
  })

  it('reads a populated page as well as an id', () => {
    const link = linkOf(toRichText(internal({ relationTo: 'pages', value: { id: 6 } }), paths))
    expect(link).toMatchObject({ kind: 'link', href: '/' })
  })

  it('ignores any address stored beside the page', () => {
    const state = root({
      type: 'paragraph',
      children: [
        {
          type: 'link',
          fields: { linkType: 'internal', doc: { relationTo: 'pages', value: 5 }, url: '/old' },
          children: [text('Staff')],
        },
      ],
    })
    expect(linkOf(toRichText(state, paths))).toMatchObject({ href: '/about/staff' })
  })

  /** Unpublished, staff-only, deleted or another site's page: the words stay, the link goes. */
  it('keeps the words of a link to a page with no current path', () => {
    expect(linkOf(toRichText(internal({ relationTo: 'pages', value: 99 }), paths))).toEqual({
      kind: 'text',
      text: 'Our staff',
      marks: [],
    })
  })

  it('keeps the words when no paths are given', () => {
    expect(linkOf(toRichText(internal({ relationTo: 'pages', value: 5 })))).toMatchObject({
      kind: 'text',
    })
  })

  it('keeps the words of a link to anything that is not a page', () => {
    expect(linkOf(toRichText(internal({ relationTo: 'users', value: 5 }), paths))).toMatchObject({
      kind: 'text',
    })
  })

  it('resolves links inside list items too', () => {
    const state = root({
      type: 'list',
      listType: 'bullet',
      children: [
        {
          type: 'listitem',
          children: [
            {
              type: 'link',
              fields: { linkType: 'internal', doc: { relationTo: 'pages', value: 5 } },
              children: [text('Staff')],
            },
          ],
        },
      ],
    })
    const [list] = toRichText(state, paths)
    expect(list?.kind === 'list' ? list.items[0]?.children[0] : null).toMatchObject({
      kind: 'link',
      href: '/about/staff',
    })
  })
})

/**
 * The editor's added features (Jason, 2026-11-19): alignment (start, center, end — never
 * justify), block quotes, a horizontal line, and images from the site's library.
 */
describe('toRichText — alignment, quotes, lines and images', () => {
  const para = (format: string) => ({ type: 'paragraph', format, children: [text('Hi')] })

  it('center and end are kept; start, left, justify and none are the default', () => {
    const [center, right, end, left, start, justify, none] = toRichText(
      root(
        para('center'),
        para('right'),
        para('end'),
        para('left'),
        para('start'),
        para('justify'),
        para(''),
      ),
    )
    expect(center).toMatchObject({ kind: 'paragraph', align: 'center' })
    // Right is END: an English page's right edge is an Arabic translation's left (`08` §6).
    expect(right).toMatchObject({ align: 'end' })
    expect(end).toMatchObject({ align: 'end' })
    for (const block of [left, start, justify, none]) expect(block).not.toHaveProperty('align')
  })

  it('a heading keeps its alignment too', () => {
    expect(
      toRichText(root({ type: 'heading', tag: 'h2', format: 'center', children: [text('Hi')] })),
    ).toEqual([
      {
        kind: 'heading',
        level: 2,
        align: 'center',
        children: [{ kind: 'text', text: 'Hi', marks: [] }],
      },
    ])
  })

  it('maps a quote; an empty one is dropped', () => {
    expect(toRichText(root({ type: 'quote', children: [text('We grow together.')] }))).toEqual([
      { kind: 'quote', children: [{ kind: 'text', text: 'We grow together.', marks: [] }] },
    ])
    expect(toRichText(root({ type: 'quote', children: [text('  ')] }))).toEqual([])
  })

  it('maps a horizontal line', () => {
    expect(toRichText(root({ type: 'horizontalrule' }))).toEqual([{ kind: 'rule' }])
  })

  it('an image from the library, by its id — the content layer fills it in', () => {
    expect(
      toRichText(root({ type: 'upload', relationTo: 'resources', value: 7, fields: {} })),
    ).toEqual([{ kind: 'image', id: '7', image: null, size: 'full', position: 'block' }])
  })

  it('an image already filled in is read as the library’s, alt text and all', () => {
    const [image] = toRichText(
      root({
        type: 'upload',
        relationTo: 'resources',
        value: {
          id: 7,
          kind: 'image',
          url: '/api/resources/file/bus.jpg',
          width: 800,
          height: 600,
          alt: 'A yellow school bus',
        },
      }),
    )
    expect(image).toMatchObject({
      kind: 'image',
      id: '7',
      image: { src: '/api/resources/file/bus.jpg', alt: 'A yellow school bus' },
    })
  })

  it('an upload from anywhere but the library, or with no id, is dropped', () => {
    expect(toRichText(root({ type: 'upload', relationTo: 'media', value: 7 }))).toEqual([])
    expect(toRichText(root({ type: 'upload', relationTo: 'resources' }))).toEqual([])
  })
})

/** Jason, 2026-11-19: a minor heading, one "Large text" style, and an image's size and place. */
describe('toRichText — minor heading, large text, image size and position', () => {
  it('maps h4 to a minor heading, level 4', () => {
    expect(toRichText(root({ type: 'heading', tag: 'h4', children: [text('Bus 12')] }))).toEqual([
      { kind: 'heading', level: 4, children: [{ kind: 'text', text: 'Bus 12', marks: [] }] },
    ])
  })

  it('reads the one text style, "Large text", as a mark beside bold and italic', () => {
    const [block] = toRichText(
      root({
        type: 'paragraph',
        children: [{ type: 'text', text: 'Welcome!', format: 1, $: { size: 'large' } }],
      }),
    )
    expect(block).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'Welcome!', marks: ['strong', 'large'] }],
    })
  })

  it('any other text state — a color, an unknown size — is dropped; the words stay', () => {
    const [block] = toRichText(
      root({
        type: 'paragraph',
        children: [{ type: 'text', text: 'Hi', $: { size: 'huge', color: 'red' } }],
      }),
    )
    expect(block).toEqual({
      kind: 'paragraph',
      children: [{ kind: 'text', text: 'Hi', marks: [] }],
    })
  })

  it('an image keeps its size and position', () => {
    const [image] = toRichText(
      root({
        type: 'upload',
        relationTo: 'resources',
        value: 7,
        fields: { size: 'small', position: 'end' },
      }),
    )
    expect(image).toEqual({ kind: 'image', id: '7', image: null, size: 'small', position: 'end' })
  })

  it('an image with no or unknown settings is full width, on its own line', () => {
    const [image] = toRichText(
      root({
        type: 'upload',
        relationTo: 'resources',
        value: 7,
        fields: { size: 'giant', position: 'left' },
      }),
    )
    expect(image).toMatchObject({ size: 'full', position: 'block' })
  })
})

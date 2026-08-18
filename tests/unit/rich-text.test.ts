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

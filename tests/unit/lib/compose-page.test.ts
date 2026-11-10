import { describe, expect, it } from 'vitest'

import { composeBody } from '@/lib/compose-page'

/**
 * Every page composed (Jason, 2026-11-04): a page's `body` becomes a Text section at the top of
 * its sections, because the public page renders the body above them today.
 */

const lexical = (...paragraphs: string[]) => ({
  root: {
    type: 'root',
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    children: paragraphs.map((text) => ({
      type: 'paragraph',
      version: 1,
      children: text === '' ? [] : [{ type: 'text', text, version: 1 }],
    })),
  },
})

const feed = { id: 'feed-1', blockType: 'feed', heading: 'News', boards: [3] }

describe('composeBody', () => {
  it('puts the words in a Text section of their own', () => {
    const body = lexical('Welcome.')
    const result = composeBody(body, [])
    expect(result.changed).toBe(true)
    expect(result.layout).toEqual([{ blockType: 'richText', content: body }])
  })

  it('above the sections the page already has, which keep their ids and order', () => {
    const body = lexical('Welcome.')
    const words = { id: 'w-1', blockType: 'richText', content: lexical('Later.') }
    const result = composeBody(body, [feed, words])
    expect(result.layout).toEqual([{ blockType: 'richText', content: body }, feed, words])
  })

  it('changes nothing when there are no words — an empty body or one of empty paragraphs', () => {
    for (const body of [null, undefined, lexical(), lexical('', '  '), { root: {} }, 'nonsense']) {
      expect(composeBody(body, [feed])).toEqual({ changed: false, layout: [feed] })
    }
  })

  it('keeps a body with only a heading or a list — words are words', () => {
    const body = {
      root: {
        type: 'root',
        children: [
          { type: 'heading', tag: 'h2', children: [{ type: 'text', text: 'Hours', version: 1 }] },
        ],
      },
    }
    expect(composeBody(body, []).changed).toBe(true)
  })

  it('reads a missing or malformed layout as no sections', () => {
    const body = lexical('Welcome.')
    for (const layout of [null, undefined, 'x', {}]) {
      expect(composeBody(body, layout).layout).toEqual([{ blockType: 'richText', content: body }])
    }
  })
})

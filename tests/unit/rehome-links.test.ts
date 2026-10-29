import { describe, expect, it } from 'vitest'

import { rehomeBlocks, rehomeRichText } from '@/content/rehome-links'
import type { PageBlock, RichText } from '@/content/types'

/**
 * Reused content (Jason, 2026-10-29) is a district page shown at a SCHOOL's address. Its links
 * were written for the district site: `/enroll` there means the district's Enroll page, and on
 * the school's host it would mean the school's. So every link that is a path on the site is
 * made a full district address before it is shown elsewhere. Full addresses, `mailto:` and
 * `tel:` are already right and stay as they are.
 */
const ORIGIN = 'https://dd2.example'
const link = (href: string) => ({
  kind: 'link' as const,
  href,
  newTab: false,
  children: [{ kind: 'text' as const, text: 'x', marks: [] }],
})

describe('rehomeRichText', () => {
  it('makes a path a district address, and leaves every other link alone', () => {
    const words: RichText = [
      {
        kind: 'paragraph',
        children: [
          link('/enroll'),
          link('/'),
          link('https://forms.office.com/x'),
          link('mailto:office@dd2.example'),
          link('tel:+18435550100'),
          { kind: 'text', text: ' plain', marks: [] },
        ],
      },
    ]
    const [paragraph] = rehomeRichText(words, ORIGIN)
    expect(
      paragraph?.kind === 'paragraph'
        ? paragraph.children.map((c) => (c.kind === 'link' ? c.href : c.text))
        : null,
    ).toEqual([
      'https://dd2.example/enroll',
      'https://dd2.example/',
      'https://forms.office.com/x',
      'mailto:office@dd2.example',
      'tel:+18435550100',
      ' plain',
    ])
  })

  it('reaches headings and nested lists', () => {
    const words: RichText = [
      { kind: 'heading', level: 2, children: [link('/a')] },
      {
        kind: 'list',
        ordered: false,
        items: [
          {
            children: [link('/b')],
            list: { kind: 'list', ordered: true, items: [{ children: [link('/c')], list: null }] },
          },
        ],
      },
    ]
    expect(
      JSON.stringify(rehomeRichText(words, ORIGIN)).match(/https:\/\/dd2\.example\/[abc]/g),
    ).toEqual(['https://dd2.example/a', 'https://dd2.example/b', 'https://dd2.example/c'])
  })

  it('does not change the words it was given', () => {
    const words: RichText = [{ kind: 'paragraph', children: [link('/a')] }]
    rehomeRichText(words, ORIGIN)
    expect(JSON.stringify(words)).toContain('"href":"/a"')
  })
})

describe('rehomeBlocks', () => {
  it('rehomes a button, cards, and the words in text and accordion blocks', () => {
    const words: RichText = [{ kind: 'paragraph', children: [link('/w')] }]
    const blocks: PageBlock[] = [
      { kind: 'richText', id: '1', content: words },
      {
        kind: 'callToAction',
        id: '2',
        heading: 'Go',
        text: null,
        href: '/enroll',
        linkLabel: 'Enroll',
        newTab: false,
      },
      { kind: 'accordion', id: '3', heading: null, items: [{ heading: 'Q', content: words }] },
      {
        kind: 'cardGrid',
        id: '4',
        heading: null,
        cards: [
          { title: 'A', text: null, href: '/athletics' },
          { title: 'B', text: null, href: null },
          { title: 'C', text: null, href: 'https://example.org' },
        ],
      },
      { kind: 'divider', id: '5' },
    ]
    const out = JSON.stringify(rehomeBlocks(blocks, ORIGIN))
    expect(out).toContain('"href":"https://dd2.example/w"')
    expect(out).toContain('"href":"https://dd2.example/enroll"')
    expect(out).toContain('"href":"https://dd2.example/athletics"')
    expect(out).toContain('"href":null')
    expect(out).toContain('"href":"https://example.org"')
    expect(out).not.toMatch(/"href":"\/[a-z]/)
  })
})

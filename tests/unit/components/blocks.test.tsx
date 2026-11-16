// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { BlockList } from '@/blocks'
import type {
  AccordionBlock,
  CallToActionBlock,
  CardGridBlock,
  ChildPageNavBlock,
  EmbedBlock,
  PageLink,
  ResolvedDocumentListBlock,
  ResolvedFeedBlock,
  ResolvedPageBlock,
  RichTextPageBlock,
} from '@/content/types'

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
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders blocks in author order', () => {
    const blocks: ResolvedPageBlock[] = [richText('a', 'First'), cta('b'), richText('c', 'Third')]
    const { container } = renderComponent(<BlockList childPages={[]} blocks={blocks} />)

    const headings = [...container.querySelectorAll('h2')].map((el) => el.textContent)
    expect(headings).toEqual(['First', 'Enroll for the fall', 'Third'])
  })

  /**
   * THE CLAIM `03` §3.2 MAKES. Every block's own heading is the same level wherever it sits,
   * because the level is derived from the page outline rather than from position in the array.
   * Reordering is therefore not a way to produce a violation.
   */
  it('gives every block the same heading level regardless of order', () => {
    const forward = renderComponent(
      <BlockList childPages={[]} blocks={[cta('a'), richText('b', 'Second')]} />,
    )
    expect(levelsIn(forward.container)).toEqual([2, 2])

    const reversed = renderComponent(
      <BlockList childPages={[]} blocks={[richText('b', 'Second'), cta('a')]} />,
    )
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

    const { container } = renderComponent(
      <BlockList baseLevel={3} childPages={[]} blocks={[nested, cta('b')]} />,
    )
    expect(levelsIn(container)).toEqual([3, 4, 3])
  })

  /** Never `h1`: the page title owns it, so a block can never give the page a second. */
  it('clamps a base level that would collide with the page title', () => {
    const { container } = renderComponent(
      <BlockList baseLevel={1} childPages={[]} blocks={[cta('a')]} />,
    )
    expect(levelsIn(container)).toEqual([2])
  })
})

describe('CallToAction', () => {
  it('renders the button as a link, not a button element', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[cta('a')]} />)

    const action = container.querySelector('a[href="/enroll"]')
    expect(action).not.toBeNull()
    expect(action?.textContent).toContain('Start enrollment')
    expect(container.querySelector('button')).toBeNull()
  })

  /** WCAG 3.2.5 — `Link` owns the notice, so the block gets it by not reimplementing one. */
  it('announces a new window', () => {
    const { container } = renderComponent(
      <BlockList childPages={[]} blocks={[cta('a', { newTab: true })]} />,
    )

    const action = container.querySelector('a[href="/enroll"]')
    expect(action?.getAttribute('target')).toBe('_blank')
    expect(action?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(action?.textContent).toContain('opens in a new window')
  })

  it('renders without a heading or supporting line', () => {
    const bare = cta('a', { heading: null, text: null })
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[bare]} />)

    expect(levelsIn(container)).toEqual([])
    expect(container.querySelector('a[href="/enroll"]')).not.toBeNull()
  })
})

const prose = (value: string) => [
  { kind: 'paragraph' as const, children: [{ kind: 'text' as const, text: value, marks: [] }] },
]

describe('Accordion', () => {
  const block = (overrides: Partial<AccordionBlock> = {}): AccordionBlock => ({
    kind: 'accordion',
    id: 'faq',
    heading: 'Common questions',
    items: [
      { heading: 'When does the bus run?', content: prose('From 6:45 a.m.') },
      { heading: 'Where does it stop?', content: prose('The main lot.') },
    ],
    ...overrides,
  })

  /**
   * The browser supplies expand/collapse, keyboard handling, and the expanded state. A
   * scripted disclosure would be more code to keep conformant for no gain.
   */
  it('uses native disclosures', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[block()]} />)
    expect(container.querySelectorAll('details')).toHaveLength(2)
    expect(container.querySelectorAll('summary')).toHaveLength(2)
  })

  /** Questions stay in the page outline, so they can be navigated without tabbing. */
  it('puts each question in the outline below the set heading', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[block()]} />)
    expect(levelsIn(container)).toEqual([2, 3, 3])

    const questions = [...container.querySelectorAll('summary h3')].map((el) => el.textContent)
    expect(questions).toEqual(['When does the bus run?', 'Where does it stop?'])
  })

  /**
   * Without a set heading the questions ARE the block's top level. Skipping to h3 to leave
   * room for a heading that does not exist is the outline gap `07` §3 rules out.
   */
  it('does not skip a level when the set has no heading', () => {
    const { container } = renderComponent(
      <BlockList childPages={[]} blocks={[block({ heading: null })]} />,
    )
    expect(levelsIn(container)).toEqual([2, 2])
  })

  /** An author's headings inside an answer sit below the question they belong to. */
  it('nests an answer’s own headings under its question', () => {
    const withHeading = block({
      heading: null,
      items: [
        {
          heading: 'What do I bring?',
          content: [
            { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Forms', marks: [] }] },
          ],
        },
      ],
    })
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[withHeading]} />)
    expect(levelsIn(container)).toEqual([2, 3])
  })
})

describe('CardGrid', () => {
  const block = (overrides: Partial<CardGridBlock> = {}): CardGridBlock => ({
    kind: 'cardGrid',
    id: 'programs',
    heading: 'Programs',
    cards: [
      { title: 'Athletics', text: 'Fall sign-ups are open.', href: '/athletics' },
      { title: 'Arts', text: null, href: null },
    ],
    ...overrides,
  })

  /** "List, 2 items" is what lets a screen-reader user skip the set instead of hearing it. */
  it('renders the cards as a list', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[block()]} />)
    expect(container.querySelectorAll('ul > li')).toHaveLength(2)
  })

  it('puts each card title in the outline below the set heading', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[block()]} />)
    expect(levelsIn(container)).toEqual([2, 3, 3])
  })

  it('does not skip a level when the set has no heading', () => {
    const { container } = renderComponent(
      <BlockList childPages={[]} blocks={[block({ heading: null })]} />,
    )
    expect(levelsIn(container)).toEqual([2, 2])
  })

  /**
   * The link is the title, not the card. A card-sized target either swallows the blurb into
   * the link's accessible name or needs an overlay that breaks text selection.
   */
  it('links from the title and leaves an unlinked card unlinked', () => {
    const { container } = renderComponent(<BlockList childPages={[]} blocks={[block()]} />)

    const links = [...container.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe('/athletics')
    expect(links[0]?.closest('h3')).not.toBeNull()
  })
})

describe('Divider', () => {
  /** `<hr>` means thematic break — the semantic the editor is reaching for. */
  it('renders a thematic break, not a hidden decoration', () => {
    const { container } = renderComponent(
      <BlockList childPages={[]} blocks={[{ kind: 'divider', id: 'd' } as ResolvedPageBlock]} />,
    )

    const rule = container.querySelector('hr')
    expect(rule).not.toBeNull()
    expect(rule?.getAttribute('aria-hidden')).toBeNull()
  })
})

/**
 * `ChildPageNav` — the section menu (`03` §3.1).
 *
 * THE ONE BLOCK THAT RENDERS SOMETHING IT WAS NOT STORED WITH. Its content is the current
 * page's children, which `src/content/pages.ts` resolves and `BlockList` threads down as a
 * prop. `src/blocks/` may not import the Payload SDK (CLAUDE.md rule 1), so the block cannot
 * and must not fetch for itself — these tests pin that it renders only what it is handed.
 */
describe('ChildPageNav', () => {
  const block = (overrides: Partial<ChildPageNavBlock> = {}): ChildPageNavBlock => ({
    kind: 'childPageNav',
    id: 'section',
    heading: 'In this section',
    ...overrides,
  })

  const CHILDREN: PageLink[] = [
    { id: '1', title: 'Bell schedule', path: '/about/bell-schedule' },
    { id: '2', title: 'Staff', path: '/about/staff' },
  ]

  it('renders the children it is handed, as a list of links', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={CHILDREN} />)

    const links = [...container.querySelectorAll('nav ul > li > a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/about/bell-schedule',
      '/about/staff',
    ])
    expect(links.map((a) => a.textContent)).toEqual(['Bell schedule', 'Staff'])
  })

  /**
   * A leaf page carrying this block shows NOTHING rather than an empty menu or a "no pages
   * here" notice. The mapper cannot make this call — the children are not in the block's row —
   * so the drop happens here, which is the one place that knows the answer.
   */
  it('renders nothing when the page has no children', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={[]} />)
    expect(container.firstChild).toBeNull()
  })

  /**
   * Two `nav` landmarks on one page must be told apart — the public template already renders
   * a language switcher. The heading names this one when there is one, so the name a screen
   * reader announces and the words on the screen cannot drift apart.
   */
  it('names the landmark with its own heading', () => {
    const { getByRole } = renderComponent(<BlockList blocks={[block()]} childPages={CHILDREN} />)
    expect(getByRole('navigation', { name: 'In this section' })).toBeTruthy()
  })

  it('still names the landmark when the editor gave it no heading', () => {
    const { container, getByRole } = renderComponent(
      <BlockList blocks={[block({ heading: null })]} childPages={CHILDREN} />,
    )

    expect(getByRole('navigation', { name: 'In this section' })).toBeTruthy()
    // No heading rendered, and therefore no gap in the outline where one was skipped.
    expect(levelsIn(container)).toEqual([])
  })

  it('takes its heading level from the page outline', () => {
    const { container } = renderComponent(
      <BlockList baseLevel={3} blocks={[block()]} childPages={CHILDREN} />,
    )
    expect(levelsIn(container)).toEqual([3])
  })

  /**
   * The page titles are links, never headings. A menu of nine child pages would otherwise put
   * nine entries in the outline and bury the page's real structure underneath them.
   */
  it('does not put the child titles in the outline', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={CHILDREN} />)
    expect(levelsIn(container)).toEqual([2])
  })
})

/**
 * `Embed` (`03` §3.1, `07` §6).
 *
 * The component receives `src` and `href` already normalized and allowlisted by
 * `src/lib/embed-url.ts` — it neither parses nor validates. These tests are about the two
 * things `07` §6 requires of every embed: an accessible name on the frame, and a VISIBLE
 * fallback link so the content is still reachable when the frame is blocked or unusable.
 */
describe('Embed', () => {
  const block = (overrides: Partial<EmbedBlock> = {}): EmbedBlock => ({
    kind: 'embed',
    id: 'video',
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    href: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Board meeting, 12 August 2026',
    ...overrides,
  })

  it('renders the frame with the allowlisted source and an accessible name', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={[]} />)

    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    // WCAG 4.1.2 — without this the frame is announced as "frame" and nothing else.
    expect(frame?.getAttribute('title')).toBe('Board meeting, 12 August 2026')
  })

  /**
   * `07` §6, and the reason it is not optional: an embed is DD2's accessibility obligation even
   * though DD2 did not build it. When the frame fails — blocked at the network, refused by a
   * browser setting, unusable with the visitor's assistive technology — the link is what keeps
   * the content reachable. It points at the watch page, never the frame URL, because an embed
   * URL opened as a page is a bare player with no title, description or captions menu.
   */
  it('renders a visible fallback link to the watch page', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={[]} />)

    const link = container.querySelector('figcaption a')
    expect(link?.getAttribute('href')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    // Named for the destination, not "click here" (WCAG 2.4.4).
    expect(link?.textContent).toContain('Board meeting, 12 August 2026')
  })

  /** No heading: the block has a title for the frame, and a title is not an outline entry. */
  it('adds nothing to the page outline', () => {
    const { container } = renderComponent(<BlockList blocks={[block()]} childPages={[]} />)
    expect(levelsIn(container)).toEqual([])
  })
})

/**
 * A news feed, RESOLVED (Jason, 2026-10-28): the renderer gets ready items and fetches nothing.
 * Its headlines sit one level under its own heading, so a feed cannot skip a level wherever an
 * editor puts it (`03` §3.2).
 */
describe('NewsFeed', () => {
  const feed = (overrides: Partial<ResolvedFeedBlock> = {}): ResolvedFeedBlock => ({
    kind: 'feed',
    id: 'feed-1',
    heading: 'District news',
    items: [
      {
        id: '1',
        title: 'Snow day',
        href: 'https://dd2.org/news/snow-day',
        date: { iso: '2026-10-28T15:00:00.000Z', label: 'October 28, 2026' },
        summary: 'Schools are closed.',
        thumbnail: null,
      },
    ],
    moreHref: '/news',
    ...overrides,
  })

  it('a named region: the heading at the block level, the headlines one below it', () => {
    const { container } = renderComponent(<BlockList blocks={[feed()]} childPages={[]} />)
    const section = container.querySelector('section')!
    expect(section.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id)
    expect(container.querySelector('h2')!.textContent).toBe('District news')
    expect(container.querySelector('h3 a')!.getAttribute('href')).toBe(
      'https://dd2.org/news/snow-day',
    )
  })

  it('without a heading, the headlines take the block level', () => {
    const { container } = renderComponent(
      <BlockList blocks={[feed({ heading: null })]} childPages={[]} />,
    )
    expect(container.querySelector('h2 a')!.textContent).toBe('Snow day')
    expect(container.querySelector('h3')).toBeNull()
  })

  it('ends with a link to every announcement on the site', () => {
    const { container } = renderComponent(<BlockList blocks={[feed()]} childPages={[]} />)
    const more = [...container.querySelectorAll('a')].find((a) => a.textContent === 'More news')
    expect(more?.getAttribute('href')).toBe('/news')
  })

  /** Jason, 2026-11-13: a thumbnail beside an announcement with an image, skipped by a screen reader. */
  it('an announcement’s image is a thumbnail with empty alt text, beside its headline', () => {
    const thumbnail = {
      src: '/gym.webp',
      width: 1600,
      height: 900,
      alt: '',
      srcSet: '/gym.webp 1600w',
    }
    const [item] = feed().items
    const { container } = renderComponent(
      <BlockList blocks={[feed({ items: [{ ...item!, thumbnail }] })]} childPages={[]} />,
    )
    const img = container.querySelector('li img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('srcset')).toBe('/gym.webp 1600w')
    expect(container.querySelector('li h3 a')!.textContent).toBe('Snow day')
  })

  it('no image, no img — never an empty one', () => {
    const { container } = renderComponent(<BlockList blocks={[feed()]} childPages={[]} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders nothing with no items — the resolve pass drops it, and the renderer agrees', () => {
    const { container } = renderComponent(
      <BlockList blocks={[feed({ items: [] })]} childPages={[]} />,
    )
    expect(container.innerHTML).toBe('')
  })
})

/**
 * A document list (Jason, 2026-11-16): one folder's documents, each link naming its type and size;
 * one not checked for accessibility carries the note offering an accessible copy (`07` §5).
 */
describe('DocumentList', () => {
  const list = (overrides: Partial<ResolvedDocumentListBlock> = {}): ResolvedDocumentListBlock => ({
    kind: 'documentList',
    id: 'docs',
    heading: 'Forms',
    contactName: 'School A',
    documents: [
      {
        id: '1',
        title: 'Allergy plan',
        href: '/api/resources/file/allergy.pdf',
        fileType: 'PDF',
        fileSize: '240 KB',
        description: null,
        unchecked: true,
      },
      {
        id: '2',
        title: 'Bus request',
        href: '/api/resources/file/bus.docx',
        fileType: 'Word',
        fileSize: null,
        description: 'Return it to the office.',
        unchecked: false,
      },
    ],
    ...overrides,
  })

  it('a named region: the heading at the block level, each document a list item', () => {
    const { container } = renderComponent(<BlockList blocks={[list()]} childPages={[]} />)
    const section = container.querySelector('section')!
    expect(section.getAttribute('aria-labelledby')).toBe(container.querySelector('h2')!.id)
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.querySelector('h3')).toBeNull()
  })

  it('each link names what it opens — title, type and size', () => {
    const { container } = renderComponent(<BlockList blocks={[list()]} childPages={[]} />)
    const links = [...container.querySelectorAll('li a')]
    expect(links.map((a) => a.textContent)).toEqual([
      'Allergy plan (PDF, 240 KB)',
      'Bus request (Word)',
    ])
    expect(links[0]!.getAttribute('href')).toBe('/api/resources/file/allergy.pdf')
  })

  it('only the unchecked document carries the note, naming whom to ask', () => {
    const { container } = renderComponent(<BlockList blocks={[list()]} childPages={[]} />)
    const [first, second] = [...container.querySelectorAll('li')]
    expect(first!.textContent).toContain('Contact School A for an accessible copy.')
    expect(second!.textContent).not.toContain('accessible copy')
    expect(second!.textContent).toContain('Return it to the office.')
  })

  it('without a heading, just the list; with no documents, nothing', () => {
    const bare = renderComponent(<BlockList blocks={[list({ heading: null })]} childPages={[]} />)
    expect(bare.container.querySelector('section')).toBeNull()
    expect(bare.container.querySelector('ul')).not.toBeNull()
    const empty = renderComponent(<BlockList blocks={[list({ documents: [] })]} childPages={[]} />)
    expect(empty.container.innerHTML).toBe('')
  })
})

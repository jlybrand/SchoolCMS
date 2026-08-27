// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { RichText } from '@/components/RichText'
import type { RichText as RichTextDoc } from '@/content/types'

import { renderComponent } from '../../helpers/render'

/**
 * The body renderer (`03` §3, `07` §3).
 *
 * It consumes DD2 domain nodes, never Lexical editor state — the mapping happens once, at the
 * content boundary (`src/content/rich-text.ts`). So what is under test here is the second half
 * of the heading-order claim: an author picks h2 or h3 in the editor, and the renderer decides
 * what element that becomes based on where the body sits in the page outline. An author cannot
 * reach the element.
 */

const text = (value: string, marks: ('strong' | 'em')[] = []) =>
  ({ kind: 'text', text: value, marks }) as const

const para = (value: string): RichTextDoc[number] => ({
  kind: 'paragraph',
  children: [text(value)],
})

describe('RichText', () => {
  it('renders paragraphs in order', () => {
    const { container } = renderComponent(
      <RichText content={[para('First notice.'), para('Second notice.')]} />,
    )

    expect([...container.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      'First notice.',
      'Second notice.',
    ])
  })

  it('renders nothing at all for empty content', () => {
    // An empty body is a legitimate value — a `calendar` page has no prose (`03` §2).
    const { container } = renderComponent(<RichText content={[]} />)
    expect(container.textContent).toBe('')
    expect(container.querySelector('div, p')).toBeNull()
  })

  describe('heading levels', () => {
    it('maps the author’s h2 and h3 to h2 and h3 directly under a page title', () => {
      const { getByRole } = renderComponent(
        <RichText
          content={[
            { kind: 'heading', level: 2, children: [text('Enrolment')] },
            { kind: 'heading', level: 3, children: [text('Documents to bring')] },
          ]}
        />,
      )

      expect(getByRole('heading', { level: 2 }).textContent).toBe('Enrolment')
      expect(getByRole('heading', { level: 3 }).textContent).toBe('Documents to bring')
    })

    it('shifts both levels when the body sits deeper in the outline', () => {
      /**
       * The reason the level is a prop and not derived from the node. Body content inside a
       * named `Section` is already one step down, so the author's "top-level heading" has to
       * become an h3 — otherwise the page jumps from h2 to h2 and the outline lies.
       */
      const { getByRole } = renderComponent(
        <RichText
          baseLevel={3}
          content={[
            { kind: 'heading', level: 2, children: [text('Enrolment')] },
            { kind: 'heading', level: 3, children: [text('Documents to bring')] },
          ]}
        />,
      )

      expect(getByRole('heading', { level: 3 }).textContent).toBe('Enrolment')
      expect(getByRole('heading', { level: 4 }).textContent).toBe('Documents to bring')
    })

    it('never renders an h1 — the page title owns it', () => {
      /**
       * Two h1s is a heading-order violation, and `PAGE_TITLE_LEVEL` is the page's. The
       * domain type admits only 2 and 3, so this guards the arithmetic rather than the input.
       */
      const { container } = renderComponent(
        <RichText
          baseLevel={1}
          content={[{ kind: 'heading', level: 2, children: [text('Enrolment')] }]}
        />,
      )

      expect(container.querySelector('h1')).toBeNull()
    })
  })

  describe('inline content', () => {
    it('renders marks as elements, not as styling', () => {
      const { container } = renderComponent(
        <RichText
          content={[
            {
              kind: 'paragraph',
              children: [text('Bring '), text('two', ['strong']), text(' forms of ID.')],
            },
          ]}
        />,
      )

      // `<strong>`, not a bold class: emphasis a screen reader can convey (`07` §4.2).
      expect(container.querySelector('strong')?.textContent).toBe('two')
    })

    it('nests both marks on one run of text', () => {
      const { container } = renderComponent(
        <RichText
          content={[{ kind: 'paragraph', children: [text('urgent', ['strong', 'em'])] }]}
        />,
      )

      expect(container.querySelector('strong em, em strong')?.textContent).toBe('urgent')
    })

    it('renders links through the Link component, underline and all', () => {
      const { getByRole } = renderComponent(
        <RichText
          content={[
            {
              kind: 'paragraph',
              children: [
                {
                  kind: 'link',
                  href: '/volunteer',
                  newTab: false,
                  children: [text('the volunteer page')],
                },
              ],
            },
          ]}
        />,
      )

      const link = getByRole('link', { name: 'the volunteer page' })
      expect(link.getAttribute('href')).toBe('/volunteer')
      expect(link.getAttribute('target')).toBeNull()
    })

    it('announces a link that opens a new window', () => {
      /**
       * `newTab` is carried through the domain type precisely so the renderer can announce it.
       * An unannounced new tab is a real orientation problem, and `Link` owns both the notice
       * and the `rel` that must accompany `target`.
       */
      const { getByRole } = renderComponent(
        <RichText
          content={[
            {
              kind: 'paragraph',
              children: [
                {
                  kind: 'link',
                  href: 'https://example.org',
                  newTab: true,
                  children: [text('Form')],
                },
              ],
            },
          ]}
        />,
      )

      const link = getByRole('link')
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
      expect(link.textContent).toMatch(/new window/i)
    })
  })

  describe('lists', () => {
    it('renders ordered and unordered lists as their own elements', () => {
      const { container } = renderComponent(
        <RichText
          content={[
            {
              kind: 'list',
              ordered: false,
              items: [{ children: [text('Pencils')], list: null }],
            },
            {
              kind: 'list',
              ordered: true,
              items: [{ children: [text('Sign in')], list: null }],
            },
          ]}
        />,
      )

      expect(container.querySelector('ul li')?.textContent).toBe('Pencils')
      expect(container.querySelector('ol li')?.textContent).toBe('Sign in')
    })

    it('preserves nesting rather than flattening it', () => {
      /**
       * Agendas nest, and flattening turns two levels of meaning into one — the same reason
       * the paste normalizer keeps nested lists (`07` §4.2).
       */
      const { container } = renderComponent(
        <RichText
          content={[
            {
              kind: 'list',
              ordered: false,
              items: [
                {
                  children: [text('New business')],
                  list: {
                    kind: 'list',
                    ordered: false,
                    items: [{ children: [text('Fundraiser')], list: null }],
                  },
                },
              ],
            },
          ]}
        />,
      )

      const nested = container.querySelector('ul li ul li')
      expect(nested?.textContent).toBe('Fundraiser')
    })
  })
})

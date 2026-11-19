// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { htmlToLexical, lexicalToHtml, type SourceContext } from '@/lib/html-source'

/**
 * THE TEXT AS HTML (Jason, 2026-11-19): "select <> and the contents of the text editor are shown
 * in HTML5" — and, edited, put back. Two pure functions, a round trip:
 *
 *   lexicalToHtml — the editor's words as clean HTML5, one block a line, nothing Lexical-only;
 *   htmlToLexical — that HTML (as the author left it) back to editor nodes, over the SAME
 *                   vocabulary, naming everything else it took out before anything changes.
 *
 * The round trip is the contract: whatever the editor can make survives being shown and put back.
 */

const ctx: SourceContext = {
  images: new Map([[7, { src: '/api/resources/file/playground.png', alt: 'The new playground' }]]),
  newId: () => 'id',
}

const text = (value: string, format = 0, large = false) => ({
  type: 'text',
  version: 1,
  text: value,
  format,
  detail: 0,
  mode: 'normal',
  style: '',
  ...(large ? { $: { size: 'large' } } : {}),
})
const block = { version: 1, format: '', indent: 0, direction: null }
const paragraph = (children: unknown[], format = '') => ({
  type: 'paragraph',
  ...block,
  format,
  textFormat: 0,
  textStyle: '',
  children,
})
const heading = (tag: string, children: unknown[], format = '') => ({
  type: 'heading',
  tag,
  ...block,
  format,
  children,
})
const item = (value: number, children: unknown[]) => ({
  type: 'listitem',
  value,
  ...block,
  children,
})
const list = (listType: 'bullet' | 'number', children: unknown[]) => ({
  type: 'list',
  listType,
  tag: listType === 'bullet' ? 'ul' : 'ol',
  start: 1,
  ...block,
  children,
})
const link = (fields: Record<string, unknown>, children: unknown[]) => ({
  ...block,
  type: 'link',
  version: 3,
  id: 'id',
  fields,
  children,
})
const root = (...children: unknown[]) => ({ type: 'root', ...block, children })

const kinds = (html: string) => htmlToLexical(html, ctx).removals.map((r) => r.kind)

const DOC = root(
  heading('h2', [text('Welcome back')]),
  paragraph([text('The first day is '), text('Monday', 1), text(', '), text('rain or shine', 2)]),
  paragraph([text('An introduction.', 0, true)], 'center'),
  paragraph([text('— The principal')], 'right'),
  list('bullet', [
    item(1, [text('Pencils')]),
    item(2, [list('number', [item(1, [text('Two of them')])])]),
  ]),
  { type: 'quote', ...block, children: [text('Every student, every day.')] },
  { type: 'horizontalrule', version: 1 },
  {
    type: 'upload',
    version: 3,
    id: 'id',
    relationTo: 'resources',
    value: 7,
    fields: { size: 'medium', position: 'start' },
    format: '',
  },
  paragraph([
    link({ linkType: 'internal', doc: { relationTo: 'pages', value: 12 }, newTab: false }, [
      text('About us'),
    ]),
    text(' and '),
    link({ linkType: 'custom', url: 'https://example.org/a?b=1&c=2', newTab: true }, [
      text('elsewhere'),
    ]),
    { type: 'linebreak', version: 1 },
    text('A second line'),
  ]),
  heading('h4', [text('Minor')]),
)

const HTML = [
  '<h2>Welcome back</h2>',
  '<p>The first day is <strong>Monday</strong>, <em>rain or shine</em></p>',
  '<p style="text-align: center"><span class="large-text">An introduction.</span></p>',
  '<p style="text-align: end">— The principal</p>',
  '<ul>',
  '  <li>Pencils',
  '    <ol>',
  '      <li>Two of them</li>',
  '    </ol>',
  '  </li>',
  '</ul>',
  '<blockquote>Every student, every day.</blockquote>',
  '<hr>',
  '<img src="/api/resources/file/playground.png" alt="The new playground" data-size="medium" data-place="start">',
  '<p><a href="/dd2/pages/12">About us</a> and <a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener">elsewhere</a><br>A second line</p>',
  '<h4>Minor</h4>',
].join('\n')

describe('lexicalToHtml', () => {
  it('writes the text as clean HTML5, one block a line, lists indented', () => {
    expect(lexicalToHtml(DOC, ctx)).toBe(HTML)
  })

  it('is empty for an empty text', () => {
    expect(lexicalToHtml(root(), ctx)).toBe('')
    expect(lexicalToHtml(null, ctx)).toBe('')
  })

  it('escapes the words and the addresses', () => {
    expect(
      lexicalToHtml(
        root(
          paragraph([link({ linkType: 'custom', url: 'https://x.org/"q"' }, [text('<a & b>')])]),
        ),
        ctx,
      ),
    ).toBe('<p><a href="https://x.org/&quot;q&quot;">&lt;a &amp; b&gt;</a></p>')
  })

  it('writes left, start and justify as no alignment — the default', () => {
    for (const format of ['left', 'start', 'justify'])
      expect(lexicalToHtml(root(paragraph([text('A')], format)), ctx)).toBe('<p>A</p>')
  })

  it('leaves out an image whose file it was not given', () => {
    expect(
      lexicalToHtml(root({ type: 'upload', version: 3, relationTo: 'resources', value: 99 }), ctx),
    ).toBe('')
  })
})

describe('htmlToLexical', () => {
  it('puts the HTML back exactly — the round trip loses nothing the editor can make', () => {
    const back = htmlToLexical(HTML, ctx)
    expect(back.removals).toEqual([])
    expect(back.children).toEqual(DOC.children.map(normalizeRight))
    expect(lexicalToHtml(root(...back.children), ctx)).toBe(HTML)
  })

  it('takes typed words with no tags as a paragraph, and blank code as an empty text', () => {
    expect(htmlToLexical('Just  words\n here', ctx).children).toEqual([
      paragraph([text('Just words here')]),
    ])
    const blank = htmlToLexical('  \n ', ctx)
    expect(blank.children).toEqual([])
    expect(blank.empty).toBe(true)
    expect(blank.removals).toEqual([])
  })

  it('makes a main heading a Heading, and says so; a deeper one a Minor heading, quietly', () => {
    const back = htmlToLexical('<h1>One</h1><h5>Five</h5><h6>Six</h6>', ctx)
    expect(back.children).toEqual([
      heading('h2', [text('One')]),
      heading('h4', [text('Five')]),
      heading('h4', [text('Six')]),
    ])
    expect(back.removals.map((r) => r.kind)).toEqual(['heading'])
  })

  it('keeps an image only from this text’s own library files, and names one it cannot keep', () => {
    const back = htmlToLexical(
      '<img src="/api/resources/file/playground.png" alt="changed"><img src="https://x.org/a.png" alt="A">',
      ctx,
    )
    expect(back.children).toEqual([
      {
        type: 'upload',
        version: 3,
        id: 'id',
        relationTo: 'resources',
        value: 7,
        fields: { size: 'full', position: 'block' },
        format: '',
      },
    ])
    expect(back.removals.map((r) => r.kind)).toEqual(['image'])
  })

  it('moves an image out of a paragraph to just after it — an image is a block of its own', () => {
    expect(
      htmlToLexical(
        '<p>Before <img src="/api/resources/file/playground.png"> after</p>',
        ctx,
      ).children.map((c) => (c as { type: string }).type),
    ).toEqual(['paragraph', 'upload'])
  })

  it('takes out embedded frames, scripts, handlers, form fields and unsafe links, naming each', () => {
    expect(kinds('<p>A</p><iframe src="https://forms.office.com/x">Loading</iframe>')).toEqual([
      'embed',
    ])
    expect(
      kinds('<script>x()</script><p onclick="y()">Hi <a href="javascript:z()">there</a></p>'),
    ).toEqual(['script'])
    expect(
      htmlToLexical('<script>x()</script><p onclick="y()">Hi</p>', ctx).removals[0]!.count,
    ).toBe(2)
    expect(kinds('<form><input><button>Send</button></form><p>A</p>')).toEqual(['form'])
    expect(kinds('<p><a href="www.example.org">site</a></p>')).toEqual(['link'])
  })

  it('keeps the words of a link it could not keep', () => {
    expect(htmlToLexical('<p><a href="javascript:z()">there</a></p>', ctx).children).toEqual([
      paragraph([text('there')]),
    ])
  })

  it('keeps center and end alignment; any other styling is named and dropped, words kept', () => {
    const back = htmlToLexical(
      '<p style="text-align:center">C</p><p style="text-align: right">R</p><p style="color:red">Red</p><p class="big">B</p><font color="blue">F</font>',
      ctx,
    )
    expect(back.children).toEqual([
      paragraph([text('C')], 'center'),
      paragraph([text('R')], 'end'),
      paragraph([text('Red')]),
      paragraph([text('B')]),
      paragraph([text('F')]),
    ])
    expect(back.removals.map((r) => r.kind)).toEqual(['styling'])
    expect(back.removals[0]!.count).toBe(3)
  })

  it('reads b and i as bold and italic, and only "large-text" as Large text', () => {
    expect(
      htmlToLexical('<p><b>B</b><i>I</i><span class="large-text">L</span><span>S</span></p>', ctx)
        .children,
    ).toEqual([paragraph([text('B', 1), text('I', 2), text('L', 0, true), text('S')])])
  })

  it('reads a permalink as a link to the page, and anything else as an address', () => {
    expect(
      htmlToLexical('<p><a href="/dd2/pages/12">P</a><a href="/news">N</a></p>', ctx).children,
    ).toEqual([
      paragraph([
        link({ linkType: 'internal', doc: { relationTo: 'pages', value: 12 }, newTab: false }, [
          text('P'),
        ]),
        link({ linkType: 'custom', url: '/news', newTab: false }, [text('N')]),
      ]),
    ])
  })

  it('names a table and keeps its words as paragraphs', () => {
    const back = htmlToLexical('<table><tr><td>One</td><td>Two</td></tr></table>', ctx)
    expect(back.removals.map((r) => r.kind)).toEqual(['table'])
    expect(back.children).toEqual([paragraph([text('One')]), paragraph([text('Two')])])
  })

  it('makes each paragraph of a quotation a quote of its own', () => {
    expect(htmlToLexical('<blockquote><p>One</p><p>Two</p></blockquote>', ctx).children).toEqual([
      { type: 'quote', ...block, children: [text('One')] },
      { type: 'quote', ...block, children: [text('Two')] },
    ])
  })

  it('is empty, with the reason, when nothing in the code can be kept', () => {
    const back = htmlToLexical('<iframe src="https://maps.google.com/x"></iframe>', ctx)
    expect(back.empty).toBe(true)
    expect(back.removals.map((r) => r.kind)).toEqual(['embed'])
  })

  it('names the accessibility and other attributes it drops — never silently — and keeps the words', () => {
    const back = htmlToLexical(
      '<p role="note" aria-live="polite">A</p><a href="/x" aria-label="More about X" title="X">more</a><span lang="fr">Bonjour</span><h2 id="top" tabindex="0">T</h2>',
      ctx,
    )
    expect(back.removals.map((r) => r.kind)).toEqual(['attributes'])
    expect(back.removals[0]!.count).toBe(4)
    expect(back.removals[0]!.message).toMatch(/aria/i)
    expect(back.removals[0]!.message).toMatch(/link/i)
  })

  it('does not count what it understands: href, target, rel, src, alt, data-size and data-place', () => {
    expect(
      kinds(
        '<p><a href="/x" target="_blank" rel="noopener">x</a></p><img src="/api/resources/file/playground.png" alt="A" data-size="small" data-place="end">',
      ),
    ).toEqual([])
  })

  it('keeps a link’s screen-reader words when they add to its words, both ways', () => {
    const html =
      '<p><a href="/bond" aria-label="Read more about the bond election">Read more</a></p>'
    const back = htmlToLexical(html, ctx)
    expect(back.removals).toEqual([])
    expect(back.children).toEqual([
      paragraph([
        link(
          {
            linkType: 'custom',
            url: '/bond',
            newTab: false,
            ariaLabel: 'Read more about the bond election',
          },
          [text('Read more')],
        ),
      ]),
    ])
    expect(lexicalToHtml(root(...back.children), ctx)).toBe(html)
  })

  it('drops a link label that only repeats the words as unneeded, and names it', () => {
    const back = htmlToLexical('<p><a href="/bond" aria-label="read more">Read more</a></p>', ctx)
    expect(back.removals.map((r) => r.kind)).toEqual(['attributes'])
    expect(JSON.stringify(back.children)).not.toContain('ariaLabel')
  })

  it('refuses a link label that leaves out the visible words (WCAG 2.5.3), and says why', () => {
    const back = htmlToLexical(
      '<p><a href="/bond" aria-label="Bond details">Read more</a></p>',
      ctx,
    )
    expect(back.removals.map((r) => r.kind)).toEqual(['label'])
    expect(back.removals[0]!.message).toMatch(/Read more|own words/)
    expect(JSON.stringify(back.children)).not.toContain('ariaLabel')
  })

  it('says a passage’s language is the page’s to set', () => {
    const back = htmlToLexical('<p><span lang="fr">Bonjour</span></p>', ctx)
    expect(back.removals[0]!.message).toMatch(/language/i)
    expect(back.removals[0]!.message).not.toMatch(/ask the district team/i)
  })

  it('lists removals in a fixed order, each once', () => {
    expect(
      kinds(
        '<p style="color:red" onclick="x()">A</p><iframe></iframe><script></script><img src="a.png">',
      ),
    ).toEqual(['embed', 'script', 'image', 'styling'])
    expect(kinds('<p aria-hidden="true" style="color:red">A</p><h1>H</h1>')).toEqual([
      'heading',
      'styling',
      'attributes',
    ])
  })
})

/** The editor stores "right"; HTML says "end", and "end" is what comes back. */
function normalizeRight(node: unknown): unknown {
  const n = node as { format?: string }
  return n.format === 'right' ? { ...n, format: 'end' } : node
}

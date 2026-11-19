// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ALLOWED_ELEMENTS,
  normalizePastedHtml,
  promoteHeadings,
  type NormalizedPaste,
} from '@/lib/paste-normalizer'

/**
 * THE PASTE NORMALIZER (`07` §4.2).
 *
 * The highest-value unit suite in the project. Pasted Word and Google Docs markup is DD2's
 * single largest source of inaccessible content, and it survives review because it *looks*
 * right — bold 14pt text instead of `<h2>`, literal `•` characters instead of list
 * semantics. Nothing downstream can recover that structure, so this is where it is fixed.
 *
 * FIXTURES FIRST (`06` §5). The three payloads in tests/fixtures/paste/ are the corpus;
 * every behaviour below is asserted against real clipboard markup rather than against a
 * hand-written string that happens to match the implementation.
 */

// Resolved from the repo root rather than `import.meta.url`: under the jsdom environment
// that URL is the document's, not this module's.
const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'tests/fixtures/paste', name), 'utf8')

const WORD_AGENDA = fixture('word-agenda.html')
const WORD_MANUAL_LIST = fixture('word-manual-list.html')
const GOOGLE_DOCS_NOTICE = fixture('google-docs-notice.html')

// --- helpers ---------------------------------------------------------------

const body = (html: string) =>
  new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body

const blocks = (html: string) => [...body(html).children]
const tagsOf = (html: string) => blocks(html).map((el) => el.tagName.toLowerCase())
const textAt = (html: string, index: number) => blocks(html)[index]?.textContent?.trim() ?? ''
const itemsAt = (html: string, index: number) =>
  [...(blocks(html)[index]?.children ?? [])].map((li) => li.textContent?.trim() ?? '')

const everyElement = (html: string) =>
  [...body(html).querySelectorAll('*')].map((el) => el.tagName.toLowerCase())

const allowed: readonly string[] = ALLOWED_ELEMENTS

const rejectionKinds = (result: NormalizedPaste) => result.rejections.map((r) => r.kind)
const candidateTexts = (result: NormalizedPaste) => result.headingCandidates.map((c) => c.text)

// ---------------------------------------------------------------------------
// The allowlist (`07` §4.2, §4.4)
// ---------------------------------------------------------------------------

describe('element allowlist', () => {
  it('is exactly the set in `07` §4.2', () => {
    expect([...ALLOWED_ELEMENTS]).toEqual([
      'p',
      'h2',
      'h3',
      'h4',
      'strong',
      'em',
      'a',
      'ul',
      'ol',
      'li',
      'blockquote',
      'hr',
    ])
  })

  it.each([WORD_AGENDA, WORD_MANUAL_LIST, GOOGLE_DOCS_NOTICE])(
    'emits no element outside the allowlist',
    (payload) => {
      const { html } = normalizePastedHtml(payload)
      const outside = everyElement(html).filter((tag) => !allowed.includes(tag))
      expect(outside).toEqual([])
    },
  )

  it.each([WORD_AGENDA, WORD_MANUAL_LIST, GOOGLE_DOCS_NOTICE])(
    'emits no attribute other than href',
    (payload) => {
      const { html } = normalizePastedHtml(payload)
      const attrs = [...body(html).querySelectorAll('*')].flatMap((el) =>
        [...el.attributes].map((a) => a.name),
      )
      expect(attrs.filter((name) => name !== 'href')).toEqual([])
    },
  )

  it('unwraps a non-allowlisted element to its text content rather than dropping it', () => {
    const { html } = normalizePastedHtml('<p>Read the <mark>important</mark> notice</p>')
    expect(html).toBe('<p>Read the important notice</p>')
  })

  it('unwraps div and span wrappers without losing block structure', () => {
    const { html } = normalizePastedHtml('<div><span>First</span></div><div>Second</div>')
    expect(tagsOf(html)).toEqual(['p', 'p'])
    expect(textAt(html, 0)).toBe('First')
    expect(textAt(html, 1)).toBe('Second')
  })

  it('drops style, script and link content entirely rather than unwrapping it to text', () => {
    const { html } = normalizePastedHtml(
      '<style>p { color: red }</style><script>alert(1)</script><p>Notice</p>',
    )
    expect(html).toBe('<p>Notice</p>')
  })

  it('maps pasted heading levels into the three the editor allows', () => {
    // Blocks own their heading levels; an editor must not be able to paste an h1 onto a
    // page that already has one, or paste an h6 and create a level the editor has no name
    // for (`07` §3). h4 is the Minor heading (2026-11-19); h5 and h6 become it.
    const { html } = normalizePastedHtml(
      '<h1>One</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>',
    )
    expect(tagsOf(html)).toEqual(['h2', 'h2', 'h3', 'h4', 'h4', 'h4'])
  })

  it('keeps a quotation, one quote per paragraph of it, holding only its words', () => {
    // The editor's quote holds a line of text, not paragraphs, so each paragraph of a
    // quotation is a quote of its own — the words and their order survive.
    const { html } = normalizePastedHtml(
      '<blockquote><p>First <b>line</b>.</p><p>Second line.</p></blockquote><p>After</p>',
    )
    expect(html).toBe(
      '<blockquote>First <strong>line</strong>.</blockquote><blockquote>Second line.</blockquote><p>After</p>',
    )
  })

  it('keeps a list or heading inside a quotation as itself, beside the quote', () => {
    const { html } = normalizePastedHtml(
      '<blockquote>Said:<ul><li>One</li></ul><h2>Title</h2></blockquote>',
    )
    expect(html).toBe('<blockquote>Said:</blockquote><ul><li>One</li></ul><h2>Title</h2>')
  })

  it('keeps a line, but never two in a row — an empty gap between lines is no content', () => {
    expect(normalizePastedHtml('<p>A</p><hr><p>B</p>').html).toBe('<p>A</p><hr><p>B</p>')
    expect(normalizePastedHtml('<p>A</p><hr><p> </p><hr /><p>B</p><hr>').html).toBe(
      '<p>A</p><hr><p>B</p><hr>',
    )
  })

  it('does not reconstruct a list or ask about a heading inside a quotation', () => {
    const result = normalizePastedHtml('<blockquote><b>Short bold</b></blockquote>')
    expect(result.html).toBe('<blockquote><strong>Short bold</strong></blockquote>')
    expect(result.headingCandidates).toEqual([])
    expect(normalizePastedHtml('<blockquote>1. Not an item</blockquote>').html).toBe(
      '<blockquote>1. Not an item</blockquote>',
    )
  })

  it('keeps bold and italic as semantic elements, not as tag names', () => {
    const { html } = normalizePastedHtml('<p><b>Bold</b> and <i>italic</i></p>')
    expect(html).toBe('<p><strong>Bold</strong> and <em>italic</em></p>')
  })
})

// ---------------------------------------------------------------------------
// Inline styles (`07` §4.2 row 1)
// ---------------------------------------------------------------------------

describe('inline style stripping', () => {
  it.each([WORD_AGENDA, WORD_MANUAL_LIST, GOOGLE_DOCS_NOTICE])(
    'leaves no style, class or mso-* residue',
    (payload) => {
      const { html } = normalizePastedHtml(payload)
      expect(html).not.toMatch(/style=/i)
      expect(html).not.toMatch(/class=/i)
      expect(html).not.toMatch(/mso-/i)
      expect(html).not.toMatch(/font-family/i)
      expect(html).not.toMatch(/Calibri|Arial/i)
    },
  )

  it('preserves bold expressed as font-weight, which is how Google Docs writes it', () => {
    // Stripping the style without reading it first would silently discard the emphasis the
    // author actually applied — Google Docs never emits <b> or <strong>.
    const { html } = normalizePastedHtml(
      '<p><span style="font-weight:700;color:#000">Important</span> notice</p>',
    )
    expect(html).toBe('<p><strong>Important</strong> notice</p>')
  })

  it('preserves italic expressed as font-style', () => {
    const { html } = normalizePastedHtml('<p><span style="font-style:italic">Note</span></p>')
    expect(html).toBe('<p><em>Note</em></p>')
  })

  it('honours font-weight:normal over the tag, which is how Google Docs wraps a paste', () => {
    // The whole payload arrives inside <b style="font-weight:normal" id="docs-internal-guid-…">.
    // Trusting the tag would bold the entire document.
    const { html } = normalizePastedHtml(
      '<b style="font-weight:normal;" id="docs-internal-guid-x"><p>Plain</p></b>',
    )
    expect(html).toBe('<p>Plain</p>')
  })
})

// ---------------------------------------------------------------------------
// List reconstruction (`07` §4.2 row 3) — the highest-value transform
// ---------------------------------------------------------------------------

describe('list reconstruction', () => {
  it.each([
    ['bullet •', '• Milk<br>• Bread', 'ul'],
    ['middle dot ·', '· Milk<br>· Bread', 'ul'],
    ['hyphen', '- Milk<br>- Bread', 'ul'],
    ['asterisk', '* Milk<br>* Bread', 'ul'],
    ['decimal', '1. Milk<br>2. Bread', 'ol'],
    ['decimal with paren', '1) Milk<br>2) Bread', 'ol'],
    ['alpha with paren', 'a) Milk<br>b) Bread', 'ol'],
    ['alpha with dot', 'a. Milk<br>b. Bread', 'ol'],
  ])('reconstructs %s lines as a real %s', (_label, inner, expected) => {
    const { html } = normalizePastedHtml(`<p>${inner}</p>`)
    expect(tagsOf(html)).toEqual([expected])
    expect(itemsAt(html, 0)).toEqual(['Milk', 'Bread'])
  })

  it('strips the marker and its trailing whitespace from the item text', () => {
    const { html } = normalizePastedHtml('<p>&#183;&nbsp;&nbsp;&nbsp; Welcome</p>')
    expect(itemsAt(html, 0)).toEqual(['Welcome'])
  })

  it('groups consecutive lines of the same marker style into one list', () => {
    const { html } = normalizePastedHtml('<p>• One<br>- Two<br>* Three</p>')
    expect(tagsOf(html)).toEqual(['ul'])
    expect(itemsAt(html, 0)).toEqual(['One', 'Two', 'Three'])
  })

  it('starts a new list when the marker style changes', () => {
    // A numbered list followed by a lettered one is two lists. Merging them would flatten
    // an agenda's sub-items into a single sequence.
    const { html } = normalizePastedHtml('<p>1. One<br>2. Two</p><p>a) Alpha<br>b) Beta</p>')
    expect(tagsOf(html)).toEqual(['ol', 'ol'])
    expect(itemsAt(html, 0)).toEqual(['One', 'Two'])
    expect(itemsAt(html, 1)).toEqual(['Alpha', 'Beta'])
  })

  it('starts a new list when a paragraph interrupts', () => {
    const { html } = normalizePastedHtml('<p>• One</p><p>Interruption</p><p>• Two</p>')
    expect(tagsOf(html)).toEqual(['ul', 'p', 'ul'])
  })

  it('leaves real list markup alone', () => {
    const { html } = normalizePastedHtml('<ul><li>One</li><li>Two</li></ul>')
    expect(html).toBe('<ul><li>One</li><li>Two</li></ul>')
  })

  it('keeps inline emphasis and links inside a reconstructed item', () => {
    const { html } = normalizePastedHtml('<p>• See <a href="/x"><b>the page</b></a></p>')
    expect(html).toBe('<ul><li>See <a href="/x"><strong>the page</strong></a></li></ul>')
  })

  it('does not treat a lone marker with no text as an item', () => {
    const { html } = normalizePastedHtml('<p>• </p><p>Real text</p>')
    expect(tagsOf(html)).toEqual(['p'])
    expect(textAt(html, 0)).toBe('Real text')
  })

  it('does not mistake an em-dash opener for a list marker', () => {
    const { html } = normalizePastedHtml('<p>&#8212; a closing thought</p>')
    expect(tagsOf(html)).toEqual(['p'])
  })
})

// ---------------------------------------------------------------------------
// Quiet normalization (`07` §4.2 row 4)
// ---------------------------------------------------------------------------

describe('quiet text normalization', () => {
  it('replaces non-breaking spaces with ordinary spaces', () => {
    const { html } = normalizePastedHtml('<p>Doors&nbsp;open&nbsp;at&nbsp;six</p>')
    expect(html).toBe('<p>Doors open at six</p>')
    expect(html).not.toContain('\u00a0')
  })

  it('straightens smart quotes and apostrophes', () => {
    const { html } = normalizePastedHtml('<p>&#8220;Read last month&#8217;s notes&#8221;</p>')
    expect(html).toBe('<p>"Read last month\'s notes"</p>')
  })

  it('leaves en and em dashes alone', () => {
    const { html } = normalizePastedHtml('<p>Grades 1&#8211;5 &#8212; all welcome</p>')
    expect(html).toBe('<p>Grades 1\u20135 \u2014 all welcome</p>')
  })

  it('collapses runs of whitespace', () => {
    const { html } = normalizePastedHtml('<p>Questions?&nbsp;&nbsp;  Email    us.</p>')
    expect(html).toBe('<p>Questions? Email us.</p>')
  })

  it('removes empty spacer paragraphs', () => {
    const { html } = normalizePastedHtml('<p>One</p><p>&nbsp;</p><p></p><p>Two</p>')
    expect(tagsOf(html)).toEqual(['p', 'p'])
  })

  it('turns a doubled break into a paragraph boundary', () => {
    const { html } = normalizePastedHtml('<p>First line<br><br>Second line</p>')
    expect(tagsOf(html)).toEqual(['p', 'p'])
    expect(textAt(html, 0)).toBe('First line')
    expect(textAt(html, 1)).toBe('Second line')
  })

  it('emits no br at all — it is not on the allowlist', () => {
    const { html } = normalizePastedHtml('<p>One<br>Two</p>')
    expect(html).not.toContain('<br')
    expect(tagsOf(html)).toEqual(['p', 'p'])
  })
})

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

describe('links', () => {
  it('keeps href and drops every other attribute', () => {
    const { html } = normalizePastedHtml(
      '<p><a href="/calendar" target="_blank" style="color:#06c" class="c1">Calendar</a></p>',
    )
    expect(html).toBe('<p><a href="/calendar">Calendar</a></p>')
  })

  it('unwraps the Google Docs redirect so the real destination is stored', () => {
    const { html } = normalizePastedHtml(
      '<p><a href="https://www.google.com/url?q=https://dd2.example.org/bus&amp;sa=D&amp;usg=x">Bus</a></p>',
    )
    expect(html).toBe('<p><a href="https://dd2.example.org/bus">Bus</a></p>')
  })

  it('unwraps a link whose scheme is not safe, keeping the text', () => {
    const { html } = normalizePastedHtml('<p><a href="javascript:alert(1)">Click</a></p>')
    expect(html).toBe('<p>Click</p>')
  })

  it.each([
    'https://dd2.example.org/x',
    'mailto:office@dd2.example.org',
    'tel:5550142',
    '/calendar',
  ])('keeps %s', (href) => {
    const { html } = normalizePastedHtml(`<p><a href="${href}">Link</a></p>`)
    expect(html).toBe(`<p><a href="${href}">Link</a></p>`)
  })
})

// ---------------------------------------------------------------------------
// Rejections (`07` §4.2 rows 6–7)
// ---------------------------------------------------------------------------

describe('rejections', () => {
  it('rejects a table and explains it in plain language with an alternative', () => {
    const result = normalizePastedHtml('<p>Before</p><table><tr><td>A</td></tr></table>')

    expect(rejectionKinds(result)).toEqual(['table'])
    expect(result.html).not.toContain('<table')
    expect(result.html).toBe('<p>Before</p>')

    const [rejection] = result.rejections
    expect(rejection?.message).toMatch(/table/i)
    // Plain language: no jargon, and it must say what to do instead.
    expect(rejection?.message).not.toMatch(/markup|semantic|DOM|WCAG|accessib/i)
    expect(rejection?.message.length).toBeGreaterThan(20)
  })

  it('rejects an embedded image and points at the upload flow', () => {
    // Alt text is captured at upload (`07` §4.3). An image that arrives by paste has no
    // route through that prompt, so it cannot be allowed in.
    const result = normalizePastedHtml(
      '<p>Before</p><p><img src="file:///C:/clip_image001.jpg"></p>',
    )

    expect(rejectionKinds(result)).toEqual(['image'])
    expect(result.html).not.toContain('<img')
    expect(result.rejections[0]?.message).toMatch(/describe|description/i)
  })

  it('reports one rejection per kind, with a count', () => {
    const result = normalizePastedHtml(
      '<table><tr><td>A</td></tr></table><table><tr><td>B</td></tr></table><img src="x.png">',
    )
    expect(rejectionKinds(result)).toEqual(['table', 'image'])
    expect(result.rejections[0]?.count).toBe(2)
    expect(result.rejections[1]?.count).toBe(1)
  })

  it('keeps the rest of the paste rather than refusing it wholesale', () => {
    // A school manager pasting an agenda with one decorative image must not lose the agenda.
    const result = normalizePastedHtml('<p>Keep me</p><img src="x.png"><p>And me</p>')
    expect(tagsOf(result.html)).toEqual(['p', 'p'])
  })

  it('reports nothing when there is nothing to reject', () => {
    expect(normalizePastedHtml('<p>Clean</p>').rejections).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Heading promotion — offered, never assumed (`07` §4.2 row 5)
// ---------------------------------------------------------------------------

describe('heading candidates', () => {
  it('never promotes a heading on its own', () => {
    const result = normalizePastedHtml('<p><b>Standing Items</b></p>')
    expect(tagsOf(result.html)).toEqual(['p'])
    expect(result.html).toBe('<p><strong>Standing Items</strong></p>')
  })

  it('offers a fully bold short line as a candidate', () => {
    const result = normalizePastedHtml('<p><b>Standing Items</b></p>')
    expect(result.headingCandidates).toEqual([{ blockIndex: 0, text: 'Standing Items' }])
  })

  it('does not offer a partially bold line', () => {
    const result = normalizePastedHtml('<p>Buses run on the <b>early</b> schedule</p>')
    expect(result.headingCandidates).toEqual([])
  })

  it('does not offer a bold line that reads as a sentence', () => {
    const result = normalizePastedHtml('<p><b>Please review the notes before you arrive.</b></p>')
    expect(result.headingCandidates).toEqual([])
  })

  it('does not offer a bold line too long to be a heading', () => {
    const long = 'Volunteer '.repeat(12).trim()
    const result = normalizePastedHtml(`<p><b>${long}</b></p>`)
    expect(result.headingCandidates).toEqual([])
  })

  it('does not offer a bold list item', () => {
    const result = normalizePastedHtml('<ul><li><b>One</b></li></ul>')
    expect(result.headingCandidates).toEqual([])
  })

  it('indexes candidates by their position among the emitted blocks', () => {
    const result = normalizePastedHtml('<p>Intro</p><p><b>Standing Items</b></p><p>• One</p>')
    expect(tagsOf(result.html)).toEqual(['p', 'p', 'ul'])
    expect(result.headingCandidates).toEqual([{ blockIndex: 1, text: 'Standing Items' }])
  })
})

describe('promoteHeadings', () => {
  const source = '<p>Intro</p><p><strong>Standing Items</strong></p><p>Body</p>'

  it('promotes the named blocks and unwraps the now-redundant bold', () => {
    expect(promoteHeadings(source, [1])).toBe('<p>Intro</p><h2>Standing Items</h2><p>Body</p>')
  })

  it('promotes to h3 when asked', () => {
    expect(promoteHeadings(source, [1], 'h3')).toBe(
      '<p>Intro</p><h3>Standing Items</h3><p>Body</p>',
    )
  })

  it('promotes several blocks in one call', () => {
    const many = '<p><strong>A</strong></p><p>Body</p><p><strong>B</strong></p>'
    expect(promoteHeadings(many, [0, 2])).toBe('<h2>A</h2><p>Body</p><h2>B</h2>')
  })

  it('is a no-op when the user declines', () => {
    expect(promoteHeadings(source, [])).toBe(source)
  })

  it('ignores an index that is out of range rather than throwing', () => {
    expect(promoteHeadings(source, [99])).toBe(source)
  })
})

// ---------------------------------------------------------------------------
// The fixture corpus, end to end
// ---------------------------------------------------------------------------

describe('fixture: Word meeting agenda', () => {
  const result = normalizePastedHtml(WORD_AGENDA)

  it('produces the expected block sequence', () => {
    expect(tagsOf(result.html)).toEqual(['p', 'p', 'p', 'ul', 'p', 'ol', 'p', 'p', 'p'])
  })

  it('reconstructs the Word bullet list', () => {
    expect(itemsAt(result.html, 3)).toEqual([
      'Welcome and introductions',
      'Approval of the August minutes',
      "Treasurer's report",
    ])
  })

  it('reconstructs the Word numbered list, keeping emphasis and the link', () => {
    expect(itemsAt(result.html, 5)).toEqual([
      'Fall fundraiser planning',
      'Playground shade structure (vote)',
      'Volunteer background checks \u2014 see the district volunteer page',
    ])
    expect(blocks(result.html)[5]?.innerHTML).toContain('<em>(vote)</em>')
    expect(blocks(result.html)[5]?.innerHTML).toContain(
      '<a href="https://www.dd2.example.org/volunteer">the district volunteer page</a>',
    )
  })

  it('offers each bold run-in line as a heading candidate without promoting any', () => {
    expect(candidateTexts(result)).toEqual([
      'PTO Meeting Agenda',
      'Standing Items',
      'New Business',
      'Meeting Dates',
    ])
    expect(tagsOf(result.html)).not.toContain('h2')
  })

  it('rejects the meeting-dates table and the embedded image', () => {
    expect(rejectionKinds(result)).toEqual(['table', 'image'])
  })

  it('drops the Word spacer paragraphs', () => {
    expect(blocks(result.html).every((el) => (el.textContent ?? '').trim() !== '')).toBe(true)
  })

  it('normalizes the smart apostrophe and the doubled break', () => {
    expect(result.html).toContain("Treasurer's report")
    expect(textAt(result.html, 7)).toBe('Questions? Email the PTO board.')
    expect(textAt(result.html, 8)).toBe('Thank you for volunteering.')
  })
})

describe('fixture: Word supply list typed with literal markers', () => {
  const result = normalizePastedHtml(WORD_MANUAL_LIST)

  it('produces the expected block sequence', () => {
    expect(tagsOf(result.html)).toEqual(['p', 'p', 'ul', 'p', 'ol', 'ol', 'p'])
  })

  it('gathers the mixed bullet characters into one list', () => {
    expect(itemsAt(result.html, 2)).toEqual([
      'Two composition notebooks',
      'One pack of #2 pencils',
      "Headphones (labeled with your child's name)",
      'A refillable water bottle',
      'Optional: tissues for the classroom',
    ])
  })

  it('keeps the numbered and lettered sequences as separate lists', () => {
    expect(itemsAt(result.html, 4)).toEqual([
      'Check in at the front office',
      'Meet your teacher in the classroom',
      'Drop supplies at the labeled bins',
    ])
    expect(itemsAt(result.html, 5)).toEqual([
      'Kindergarten uses the side entrance',
      'Grades 1\u20135 use the main doors',
    ])
  })

  it('offers the two bold lines as heading candidates', () => {
    expect(candidateTexts(result)).toEqual(['Supply List', 'Drop-off order'])
  })

  it('rejects nothing', () => {
    expect(result.rejections).toEqual([])
  })
})

describe('fixture: Google Docs early-dismissal notice', () => {
  const result = normalizePastedHtml(GOOGLE_DOCS_NOTICE)

  it('unwraps the docs-internal-guid wrapper without bolding the document', () => {
    expect(result.html).not.toContain('docs-internal-guid')
    expect(tagsOf(result.html)).toEqual(['p', 'p', 'p', 'ul', 'p', 'p'])
  })

  it('keeps the real list markup Google emits', () => {
    expect(itemsAt(result.html, 3)).toEqual([
      'Arrange afternoon pickup or childcare',
      "Confirm your child's bus stop on the transportation page",
      'Nothing else changes \u2014 morning arrival is normal.',
    ])
  })

  it('recovers bold and italic from font-weight and font-style', () => {
    expect(textAt(result.html, 0)).toBe('Early Dismissal \u2014 Friday')
    expect(blocks(result.html)[0]?.innerHTML).toBe('<strong>Early Dismissal \u2014 Friday</strong>')
    expect(blocks(result.html)[1]?.innerHTML).toContain('<strong>early</strong>')
    expect(blocks(result.html)[3]?.innerHTML).toContain('<em>Nothing else changes</em>')
  })

  it('rewrites the Google redirect to the real destination', () => {
    expect(result.html).toContain('<a href="https://www.dd2.example.org/transportation">')
    expect(result.html).not.toContain('google.com/url')
  })

  it('offers the fully bold lines as candidates and not the partially bold one', () => {
    expect(candidateTexts(result)).toEqual([
      'Early Dismissal \u2014 Friday',
      'What families need to do',
      'Questions',
    ])
  })

  it('drops the spacer breaks between paragraphs', () => {
    expect(result.html).not.toContain('<br')
    expect(blocks(result.html).every((el) => (el.textContent ?? '').trim() !== '')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Degenerate input
// ---------------------------------------------------------------------------

describe('degenerate input', () => {
  it.each(['', '   ', '<p></p>', '<div><span> </span></div>'])(
    'returns an empty result for %j rather than throwing',
    (input) => {
      const result = normalizePastedHtml(input)
      expect(result.html).toBe('')
      expect(result.rejections).toEqual([])
      expect(result.headingCandidates).toEqual([])
    },
  )

  it('wraps bare text in a paragraph', () => {
    expect(normalizePastedHtml('Just some text').html).toBe('<p>Just some text</p>')
  })

  it('escapes markup characters in text so the output cannot be re-interpreted', () => {
    const { html } = normalizePastedHtml('<p>5 &lt; 10 &amp; 10 &gt; 5</p>')
    expect(html).toBe('<p>5 &lt; 10 &amp; 10 &gt; 5</p>')
    expect(body(html).textContent).toBe('5 < 10 & 10 > 5')
  })

  it('is idempotent — normalizing its own output changes nothing', () => {
    for (const payload of [WORD_AGENDA, WORD_MANUAL_LIST, GOOGLE_DOCS_NOTICE]) {
      const once = normalizePastedHtml(payload).html
      expect(normalizePastedHtml(once).html).toBe(once)
    }
  })
})

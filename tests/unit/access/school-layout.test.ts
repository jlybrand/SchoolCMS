import { describe, expect, it } from 'vitest'

import { checkSchoolLayout, SCHOOL_BLOCKS, schoolPalette } from '@/access/school-layout'

/**
 * What a school manager may change in a page's components (Jason, 2026-11-04, level B):
 *
 *   - the SIMPLE components — Text, Button, Cards, Accordion, Divider — freely: edit, add,
 *     remove, reorder;
 *   - the DISTRICT's components — Columns, News feed, Embed, Section menu, and any added later —
 *     not at all: not edited, not removed, not added, not moved past one another;
 *   - INSIDE the district's columns, the same rules again: a school may write in a column the
 *     district placed, but not change the columns themselves.
 *
 * Release-blocking in the way the publish gate is: this is all that stands between a school and
 * the district's layout on every route (admin, REST, GraphQL). Adversarial cases throughout.
 */

const text = (id: string, words = id) => ({
  id,
  blockType: 'richText',
  content: { root: { children: [{ type: 'paragraph', children: [{ text: words }] }] } },
})
const button = (id: string, label = 'Go') => ({
  id,
  blockType: 'callToAction',
  linkLabel: label,
  href: '/go',
})
const feed = (id: string, boards = [1]) => ({
  id,
  blockType: 'feed',
  heading: 'News',
  boards,
  limit: 5,
})
const embed = (id: string) => ({
  id,
  blockType: 'embed',
  url: 'https://youtu.be/x',
  title: 'Video',
})
const columns = (id: string, cols: { id: string; heading?: string; content: unknown[] }[]) => ({
  id,
  blockType: 'columns',
  heading: 'Ways to help',
  columns: cols.map((c) => ({ heading: null, ...c })),
})

const ok = { ok: true }

describe('SCHOOL_BLOCKS — the simple palette', () => {
  it('is Text, Button, Cards, Accordion and Divider — nothing that carries data or layout', () => {
    expect([...SCHOOL_BLOCKS].sort()).toEqual(
      ['accordion', 'callToAction', 'cardGrid', 'divider', 'richText'].sort(),
    )
  })
})

describe('checkSchoolLayout — the simple components, freely', () => {
  it('edits, adds, removes and reorders simple components', () => {
    const before = [text('a', 'old'), button('b'), text('c')]
    const after = [text('c'), text('a', 'new'), text('new-1'), { id: 'n2', blockType: 'divider' }]
    expect(checkSchoolLayout(before, after)).toEqual(ok)
  })

  it('builds a page from nothing out of simple components', () => {
    expect(checkSchoolLayout([], [text('a'), button('b')])).toEqual(ok)
    expect(checkSchoolLayout(undefined, [text('a')])).toEqual(ok)
  })

  it('leaves a page with no components alone', () => {
    expect(checkSchoolLayout([], [])).toEqual(ok)
    expect(checkSchoolLayout(null, undefined)).toEqual(ok)
  })
})

describe('checkSchoolLayout — the district’s components, not at all', () => {
  const before = [text('a'), feed('f'), text('b'), embed('e')]

  it('may write around them', () => {
    expect(
      checkSchoolLayout(before, [text('x'), feed('f'), text('b', 'edited'), embed('e'), text('y')]),
    ).toEqual(ok)
  })

  it('refuses ADDING one', () => {
    expect(checkSchoolLayout([text('a')], [text('a'), feed('f2')]).ok).toBe(false)
    expect(checkSchoolLayout([], [embed('e')]).ok).toBe(false)
  })

  it('refuses REMOVING one', () => {
    expect(checkSchoolLayout(before, [text('a'), text('b'), embed('e')]).ok).toBe(false)
  })

  it('refuses EDITING one — its settings are the district’s', () => {
    expect(checkSchoolLayout(before, [text('a'), feed('f', [2]), text('b'), embed('e')]).ok).toBe(
      false,
    )
  })

  it('refuses moving them past one another', () => {
    expect(checkSchoolLayout(before, [text('a'), embed('e'), text('b'), feed('f')]).ok).toBe(false)
  })

  it('refuses passing one off as another — a district block re-sent under a simple id', () => {
    expect(checkSchoolLayout([text('a')], [{ ...feed('a') }]).ok).toBe(false)
  })

  it('refuses a duplicate of one under a new id', () => {
    expect(checkSchoolLayout(before, [...before, { ...feed('f'), id: 'copy' }]).ok).toBe(false)
  })

  it('refuses a component the palette does not know — anything added later is the district’s', () => {
    expect(checkSchoolLayout([], [{ id: 'z', blockType: 'calendar' }]).ok).toBe(false)
    // A staff list is the district's too (Jason, 2026-11-13: district only).
    expect(checkSchoolLayout([], [{ id: 'z', blockType: 'staffList' }]).ok).toBe(false)
  })

  it('refuses a row without an id where a district component was', () => {
    expect(checkSchoolLayout([feed('f')], [{ ...feed('f'), id: undefined }]).ok).toBe(false)
  })

  it('says why, in words a school manager can act on', () => {
    const result = checkSchoolLayout(before, [text('a'), text('b'), embed('e')])
    expect(result).toEqual({
      ok: false,
      reason:
        'Part of this page is set by the district and can’t be changed here. Undo that change, or ask the district web team.',
    })
  })
})

describe('checkSchoolLayout — inside the district’s columns', () => {
  const before = [
    columns('cols', [
      { id: 'c1', heading: 'Volunteer', content: [text('t1')] },
      { id: 'c2', content: [feed('f')] },
    ]),
  ]

  it('may write in a column: edit, add and remove simple components there', () => {
    const after = [
      columns('cols', [
        { id: 'c1', heading: 'Volunteer', content: [text('t1', 'edited'), button('b')] },
        { id: 'c2', content: [text('new'), feed('f')] },
      ]),
    ]
    expect(checkSchoolLayout(before, after)).toEqual(ok)
  })

  it('refuses changing the columns themselves — a heading, a column added or removed', () => {
    const retitled = structuredClone(before)
    retitled[0]!.columns[0]!.heading = 'Help'
    expect(checkSchoolLayout(before, retitled).ok).toBe(false)

    const third = structuredClone(before)
    third[0]!.columns.push({ id: 'c3', heading: null, content: [] })
    expect(checkSchoolLayout(before, third).ok).toBe(false)

    const fewer = structuredClone(before)
    fewer[0]!.columns.pop()
    expect(checkSchoolLayout(before, fewer).ok).toBe(false)
  })

  it('refuses changing the set’s own heading', () => {
    const after = structuredClone(before)
    after[0]!.heading = 'Something else'
    expect(checkSchoolLayout(before, after).ok).toBe(false)
  })

  it('holds the district’s components inside a column as firmly as on the page', () => {
    const removed = [
      columns('cols', [
        { id: 'c1', heading: 'Volunteer', content: [text('t1')] },
        { id: 'c2', content: [] },
      ]),
    ]
    expect(checkSchoolLayout(before, removed).ok).toBe(false)

    const added = [
      columns('cols', [
        { id: 'c1', heading: 'Volunteer', content: [text('t1'), embed('e')] },
        { id: 'c2', content: [feed('f')] },
      ]),
    ]
    expect(checkSchoolLayout(before, added).ok).toBe(false)
  })

  it('refuses moving a district component from one column to another', () => {
    const moved = [
      columns('cols', [
        { id: 'c1', heading: 'Volunteer', content: [text('t1'), feed('f')] },
        { id: 'c2', content: [] },
      ]),
    ]
    expect(checkSchoolLayout(before, moved).ok).toBe(false)
  })
})

describe('schoolPalette — what a school’s component picker offers', () => {
  it('is the simple components', () => {
    expect([...schoolPalette([])].sort()).toEqual([...SCHOOL_BLOCKS].sort())
  })

  /**
   * Payload fails validation on a saved block its picker does not allow, so the district's
   * components already on the page are allowed too — or a school could never save a page with a
   * news feed on it. Adding another is still refused, by `checkSchoolLayout`.
   */
  it('adds the kinds already on the page, so it can be saved', () => {
    expect(
      schoolPalette([
        { id: 'f', blockType: 'feed' },
        { id: 't', blockType: 'richText' },
      ]),
    ).toContain('feed')
    expect(schoolPalette(undefined)).not.toContain('feed')
  })
})

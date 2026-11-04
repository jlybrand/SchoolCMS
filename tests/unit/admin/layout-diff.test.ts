import { describe, expect, it } from 'vitest'

import { diffLayout } from '@/admin/Approvals/page-diff'

/**
 * The approval diff for a page's components (Jason, 2026-11-04: schools compose). Approve stays
 * one click from the diff (`04` §4.2), so each change a school makes must read as one plain line:
 * what kind of section, what it says, and what happened to it. Matched by each section's id, so
 * an edit reads as an edit and a move as a move — not as one section removed and another added.
 */

const words = (id: string, text: string) => ({
  id,
  blockType: 'richText',
  content: { root: { children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] } },
})
const button = (id: string, label: string) => ({
  id,
  blockType: 'callToAction',
  heading: null,
  linkLabel: label,
  href: '/x',
})
const cards = (id: string, titles: string[]) => ({
  id,
  blockType: 'cardGrid',
  heading: null,
  cards: titles.map((title) => ({ title })),
})

describe('diffLayout', () => {
  it('says nothing changed when nothing did', () => {
    const layout = [words('a', 'Hello'), button('b', 'Enroll')]
    expect(diffLayout(layout, structuredClone(layout))).toEqual({ changes: [], unchanged: 2 })
  })

  it('names an added section by kind and what it says', () => {
    expect(diffLayout([], [words('a', 'Welcome to our school')]).changes).toEqual([
      { change: 'added', kind: 'Text', summary: 'Welcome to our school', where: null, words: null },
    ])
  })

  it('names a removed one', () => {
    expect(diffLayout([button('b', 'Enroll now')], []).changes).toEqual([
      { change: 'removed', kind: 'Button', summary: 'Enroll now', where: null, words: null },
    ])
  })

  it('shows a changed Text section as the lines that changed', () => {
    const [change] = diffLayout([words('a', 'Old line')], [words('a', 'New line')]).changes
    expect(change).toMatchObject({ change: 'changed', kind: 'Text', summary: 'New line' })
    expect(change?.words?.changes).toEqual([
      { change: 'removed', kind: 'paragraph', lines: ['Old line'] },
      { change: 'added', kind: 'paragraph', lines: ['New line'] },
    ])
  })

  it('shows another section changed by what it says now', () => {
    expect(diffLayout([cards('c', ['A'])], [cards('c', ['A', 'B'])]).changes).toEqual([
      { change: 'changed', kind: 'Cards', summary: 'A · B', where: null, words: null },
    ])
  })

  it('says a section moved — and only the one that did', () => {
    const before = [words('a', 'First'), words('b', 'Second'), words('c', 'Third')]
    const after = [before[0], before[2], before[1]]
    expect(diffLayout(before, after).changes).toEqual([
      { change: 'moved', kind: 'Text', summary: 'Third', where: null, words: null },
    ])
  })

  it('reports changes inside the district’s columns, saying which column', () => {
    const cols = (inSecond: unknown[]) => [
      {
        id: 'cols',
        blockType: 'columns',
        heading: 'Ways to help',
        columns: [
          { id: 'c1', heading: 'Volunteer', content: [] },
          { id: 'c2', heading: null, content: inSecond },
        ],
      },
    ]
    expect(diffLayout(cols([]), cols([words('t', 'Join the PTA')])).changes).toEqual([
      {
        change: 'added',
        kind: 'Text',
        summary: 'Join the PTA',
        where: 'In column 2 of “Ways to help”',
        words: null,
      },
    ])
  })

  it('shortens a long summary', () => {
    const [change] = diffLayout([], [words('a', 'x'.repeat(200))]).changes
    expect(change?.summary.length).toBeLessThanOrEqual(81)
    expect(change?.summary.endsWith('…')).toBe(true)
  })

  it('reads a missing or malformed layout as no sections', () => {
    expect(diffLayout(null, undefined)).toEqual({ changes: [], unchanged: 0 })
    expect(diffLayout('nonsense', [words('a', 'Hi')]).changes).toHaveLength(1)
  })
})

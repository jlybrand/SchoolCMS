import { describe, expect, it } from 'vitest'

import {
  checkNewPage,
  explainCreateError,
  SCHOOL_PAGE_TYPES,
  SCHOOL_TASKS,
  submissionStatus,
} from '@/admin/SchoolPlane/school-plane'

/**
 * The school plane's landing view and new-page form (`04` §2.2, §2.4).
 *
 * The pure decisions under them: which tasks are offered, which page types a school may
 * create and how they are described, what a new page needs before it is created, how a refused
 * create is explained, and what a submission's status reads as. The views themselves are custom
 * admin React — locked by `tests/e2e/school-plane.spec.ts` per CLAUDE.md's exception table.
 */

describe('SCHOOL_TASKS — verbs, not collections (`04` §2.2)', () => {
  it('offers only tasks that work today, in the spec wording', () => {
    expect(SCHOOL_TASKS.map((t) => t.label)).toEqual(['Update a page', 'Add a page'])
  })

  it('links every task into the admin, never to a collection list', () => {
    for (const task of SCHOOL_TASKS) {
      expect(task.href).toMatch(/^\/admin\//)
      expect(task.href).not.toMatch(/\/collections\//)
    }
  })

  it('never says collection, draft or publish', () => {
    const text = SCHOOL_TASKS.map((t) => `${t.label} ${t.description}`).join(' ')
    expect(text.toLowerCase()).not.toMatch(/collection|draft|publish/)
  })
})

describe('SCHOOL_PAGE_TYPES — a short list with plain descriptions (`04` §2.4)', () => {
  it('is the fixed types, and never the district-only composed type', () => {
    expect(SCHOOL_PAGE_TYPES.map((t) => t.value)).toEqual([
      'standard',
      'about',
      'contact',
      'staff',
      'calendar',
      'documents',
    ])
  })

  it('describes every type in words a first-time user can act on', () => {
    for (const type of SCHOOL_PAGE_TYPES) {
      expect(type.label.length).toBeGreaterThan(0)
      expect(type.description.length).toBeGreaterThan(20)
      expect(type.description.toLowerCase()).not.toMatch(/collection|block|composed|slug/)
    }
  })
})

describe('checkNewPage — what a new page needs before it is created', () => {
  const ok = { title: 'Field trip forms', pageType: 'standard', schools: [7], school: 7 }

  it('accepts a title, an allowed type and the only school', () => {
    expect(checkNewPage(ok)).toEqual({ ok: true, title: 'Field trip forms', school: 7 })
  })

  it('trims the title', () => {
    expect(checkNewPage({ ...ok, title: '  Field trip forms  ' })).toMatchObject({
      ok: true,
      title: 'Field trip forms',
    })
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])('asks for a title when it is %s', (_label, title) => {
    expect(checkNewPage({ ...ok, title })).toEqual({
      ok: false,
      errors: { title: 'Give the page a title.' },
    })
  })

  it('refuses a title too long to be a page heading', () => {
    const result = checkNewPage({ ...ok, title: 'x'.repeat(121) })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.errors.title).toMatch(/shorter/)
  })

  it.each([
    ['nothing chosen', undefined],
    ['the district-only composed type', 'composed'],
    ['an unknown type', 'landing'],
  ])('asks for a page type when given %s', (_label, pageType) => {
    expect(checkNewPage({ ...ok, pageType })).toEqual({
      ok: false,
      errors: { pageType: 'Choose what kind of page this is.' },
    })
  })

  it('uses the only school without asking', () => {
    expect(checkNewPage({ ...ok, school: undefined })).toMatchObject({ ok: true, school: 7 })
  })

  it('with several schools, requires one of them to be chosen', () => {
    const several = { ...ok, schools: [7, 9], school: undefined }
    expect(checkNewPage(several)).toEqual({
      ok: false,
      errors: { school: 'Choose which school this page is for.' },
    })
    expect(checkNewPage({ ...several, school: 9 })).toMatchObject({ ok: true, school: 9 })
  })

  it('refuses a school the user is not assigned to', () => {
    expect(checkNewPage({ ...ok, school: 99 })).toEqual({
      ok: false,
      errors: { school: 'Choose which school this page is for.' },
    })
  })

  it('matches a school id given as a string, as a form field gives it', () => {
    expect(checkNewPage({ ...ok, schools: [7, 9], school: '9' })).toMatchObject({
      ok: true,
      school: 9,
    })
  })

  it('with no schools at all, says so rather than offering nothing to choose', () => {
    expect(checkNewPage({ ...ok, schools: [], school: undefined })).toEqual({
      ok: false,
      errors: {
        school: 'Your account is not linked to a school yet. Ask the district web team to add it.',
      },
    })
  })

  it('reports every problem at once', () => {
    const result = checkNewPage({
      title: '',
      pageType: undefined,
      schools: [7, 9],
      school: undefined,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['pageType', 'school', 'title'])
  })
})

describe('explainCreateError — a refused create, in words', () => {
  it('a slug clash means a page with that title already exists', () => {
    // The development build carries the hook's own message …
    expect(
      explainCreateError({
        errors: [
          {
            name: 'ValidationError',
            data: { errors: [{ path: 'slug', message: 'Another page here already uses …' }] },
            message: 'The following field is invalid: slug',
          },
        ],
      }),
    ).toBe('There is already a page with this title. Try a different title.')
    // … and the production build only the field name (see admin-validator-messages-lost).
    expect(
      explainCreateError({ errors: [{ message: 'The following field is invalid: slug' }] }),
    ).toBe('There is already a page with this title. Try a different title.')
  })

  it('a reserved address is explained the same way — the title is what they control', () => {
    expect(
      explainCreateError({
        errors: [{ data: { errors: [{ path: 'slug', message: '"search" is reserved …' }] } }],
      }),
    ).toBe('There is already a page with this title. Try a different title.')
  })

  it('a refusal by access says they cannot add pages here', () => {
    expect(
      explainCreateError({ errors: [{ message: 'You are not allowed to perform this action.' }] }),
    ).toBe('Your account cannot add pages to this school. Ask the district web team for help.')
  })

  it('anything else gets a generic sentence, never raw JSON or an empty string', () => {
    for (const body of [{}, null, 'oops', { errors: [] }, { errors: [{}] }]) {
      expect(explainCreateError(body)).toBe(
        'The page could not be created. Please try again in a moment.',
      )
    }
  })
})

describe('submissionStatus — the plain status in "Your recent submissions"', () => {
  it.each([
    ['submitted', 'Sent for approval'],
    ['changes-requested', 'Needs changes'],
    [null, null],
    ['editing', null],
    ['approved', null],
  ] as const)('%s → %s', (state, expected) => {
    expect(submissionStatus(state)).toBe(expected)
  })
})

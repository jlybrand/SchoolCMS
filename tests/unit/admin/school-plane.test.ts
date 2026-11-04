import { describe, expect, it } from 'vitest'

import {
  checkNewPage,
  checkNewPost,
  explainCreateError,
  explainPostCreateError,
  listTaskFor,
  schoolEditPath,
  schoolNamesLabel,
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
    expect(SCHOOL_TASKS.map((t) => t.label)).toEqual([
      'Post an announcement',
      'Update a page',
      'Add a page',
    ])
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

describe('listTaskFor — the create button a school manager gets on a list (Jason, 2026-11-04)', () => {
  it('offers the new-page task on Pages', () => {
    expect(listTaskFor('pages')).toEqual({ label: 'Add a page', href: '/admin/new-page' })
  })

  it('is one of the landing view’s own tasks, so the two never drift apart', () => {
    expect(SCHOOL_TASKS.map((t) => t.href)).toContain(listTaskFor('pages')?.href)
  })

  it('offers nothing on News and announcements, whose own screen has Create post', () => {
    expect(listTaskFor('posts')).toBeNull()
  })

  it('offers nothing on a list with no school task', () => {
    expect(listTaskFor('tenants')).toBeNull()
    expect(listTaskFor('users')).toBeNull()
  })
})

describe('schoolNamesLabel — which school the manager is working on', () => {
  it('names one school as it is', () => {
    expect(schoolNamesLabel(['Summerville Middle School'])).toBe('Summerville Middle School')
  })

  it('joins several in the order given', () => {
    expect(schoolNamesLabel(['School A', 'School B'])).toBe('School A, School B')
  })

  it('is null with no school, so nothing renders rather than an empty label', () => {
    expect(schoolNamesLabel([])).toBeNull()
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

  it('says an announcement approved for later is approved, not yet live (Jason, 2026-11-04)', () => {
    expect(submissionStatus('scheduled')).toBe('Approved, goes live later')
  })
})

describe('checkNewPost — what a new announcement needs before it is created', () => {
  /** The boards the user may post to: their schools' — the school follows from the board. */
  const one = [{ id: 7, tenant: 3 }]
  const two = [
    { id: 7, tenant: 3 },
    { id: 8, tenant: 4 },
  ]

  it('needs a headline and a board; with one board it is not asked, and the school follows', () => {
    expect(checkNewPost({ title: ' Picture day ', boards: one })).toEqual({
      ok: true,
      title: 'Picture day',
      board: 7,
      school: 3,
    })
  })

  it('refuses an empty or over-long headline, in its own words', () => {
    const empty = checkNewPost({ title: '  ', boards: one })
    expect(empty).toEqual({ ok: false, errors: { title: 'Give the announcement a headline.' } })
    const long = checkNewPost({ title: 'x'.repeat(121), boards: one })
    expect(long.ok ? null : long.errors.title).toMatch(/shorter/)
  })

  it('with several boards, asks which — and refuses one that is not theirs', () => {
    expect(checkNewPost({ title: 'T', boards: two, board: '8' })).toMatchObject({
      ok: true,
      board: 8,
      school: 4,
    })
    const unchosen = checkNewPost({ title: 'T', boards: two })
    expect(unchosen.ok ? null : unchosen.errors.board).toBe('Choose which board this goes on.')
    expect(checkNewPost({ title: 'T', boards: two, board: 99 }).ok).toBe(false)
  })

  it('with no boards at all, says who sets them up', () => {
    const check = checkNewPost({ title: 'T', boards: [] })
    expect(check.ok ? null : check.errors.board).toMatch(/district web team/)
  })
})

describe('explainPostCreateError', () => {
  it('a refusal by access says they cannot post here', () => {
    expect(
      explainPostCreateError({
        errors: [{ message: 'You are not allowed to perform this action.' }],
      }),
    ).toMatch(/cannot post announcements/)
  })

  it('anything else gets a generic sentence about announcements', () => {
    expect(explainPostCreateError(null)).toMatch(/announcement could not be created/)
  })
})

describe('schoolEditPath — where a submission opens', () => {
  it('opens a page or an announcement in its own form', () => {
    expect(schoolEditPath('pages', 4)).toBe('/admin/collections/pages/4')
    expect(schoolEditPath('posts', 9)).toBe('/admin/collections/posts/9')
  })
})

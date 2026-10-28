import { describe, expect, it } from 'vitest'

import { outcomeEmail, publicUrlFor, reviewOutcome } from '@/lib/review-emails'

/**
 * The submitter's email on approve or changes-requested (`04` §4.5).
 *
 * Three pure decisions: whether a write IS one of those outcomes (and not, say, an autosave or
 * a district edit), what the email says, and where its links point. The hook that sends it is
 * `src/collections/hooks/notify-review-outcome.ts`.
 */

describe('reviewOutcome — which writes send an email', () => {
  const waiting = { reviewState: 'submitted', _status: 'draft' }

  it('submitted → published and cleared is an approval', () => {
    expect(reviewOutcome(waiting, { reviewState: null, _status: 'published' })).toBe('approved')
  })

  it('submitted → changes-requested is a send-back', () => {
    expect(reviewOutcome(waiting, { reviewState: 'changes-requested', _status: 'draft' })).toBe(
      'changes-requested',
    )
  })

  it.each([
    ['a school save on a waiting page', waiting, waiting],
    ['an autosave by the school', { reviewState: 'editing' }, { reviewState: 'editing' }],
    ['sending for approval', { reviewState: 'editing' }, waiting],
    // A district publish of a page nobody sent: no submitter to tell.
    [
      'a publish of a page that was not waiting',
      { reviewState: null },
      { reviewState: null, _status: 'published' },
    ],
    ['a resend after changes were requested', { reviewState: 'changes-requested' }, waiting],
    ['a page created already sent', undefined, waiting],
    [
      'an approval that somehow left the state set',
      waiting,
      { reviewState: 'submitted', _status: 'published' },
    ],
  ])('%s sends nothing', (_label, before, after) => {
    expect(reviewOutcome(before, after)).toBeNull()
  })
})

describe('publicUrlFor — the approved page on its school site', () => {
  it("keeps the server URL's scheme and port and uses the school's hostname", () => {
    expect(publicUrlFor('http://localhost:3000', 'a.localhost', '/about/staff')).toBe(
      'http://a.localhost:3000/about/staff',
    )
  })

  it('in production, an https host with no port', () => {
    expect(publicUrlFor('https://admin.dd2.org', 'oakbrook.dd2.org', '/')).toBe(
      'https://oakbrook.dd2.org/',
    )
  })

  it('ignores any path on the server URL', () => {
    expect(publicUrlFor('https://admin.dd2.org/admin', 'dd2.org', '/news')).toBe(
      'https://dd2.org/news',
    )
  })

  it('falls back to the bare hostname over https when the server URL is unusable', () => {
    expect(publicUrlFor('', 'dd2.org', '/news')).toBe('https://dd2.org/news')
    expect(publicUrlFor('not a url', 'dd2.org', '/news')).toBe('https://dd2.org/news')
  })
})

describe('outcomeEmail — what the school manager reads', () => {
  const page = {
    title: 'Bus routes',
    school: 'Oakbrook Elementary',
    pageUrl: 'https://oakbrook.dd2.org/bus-routes',
    editUrl: 'https://admin.dd2.org/admin/collections/pages/12',
  }

  describe('approved', () => {
    const email = outcomeEmail({ outcome: 'approved', ...page })

    it('says it is live in the subject', () => {
      expect(email.subject).toBe('Your page is live: Bus routes')
    })

    it('names the page and the school, and links to the live page', () => {
      expect(email.text).toContain('“Bus routes”')
      expect(email.text).toContain('Oakbrook Elementary')
      expect(email.text).toContain(page.pageUrl)
      expect(email.html).toContain(`href="${page.pageUrl}"`)
    })
  })

  describe('changes requested', () => {
    const email = outcomeEmail({
      outcome: 'changes-requested',
      note: 'Please add the return times.',
      ...page,
    })

    it('says changes are needed in the subject', () => {
      expect(email.subject).toBe('Changes needed: Bus routes')
    })

    it('quotes the note, links to the page form, and says nothing was lost', () => {
      expect(email.text).toContain('Please add the return times.')
      expect(email.text).toContain(page.editUrl)
      expect(email.text).toContain('Send for approval')
      expect(email.text).toMatch(/nothing you wrote has been lost/i)
      expect(email.html).toContain('<blockquote')
      expect(email.html).toContain(`href="${page.editUrl}"`)
    })

    it("keeps the note's line breaks", () => {
      const multi = outcomeEmail({ outcome: 'changes-requested', note: 'One.\nTwo.', ...page })
      expect(multi.html).toContain('One.<br>Two.')
    })
  })

  it('escapes the title and note — both are typed by people', () => {
    const email = outcomeEmail({
      outcome: 'changes-requested',
      ...page,
      title: '<script>alert(1)</script> & "more"',
      note: '<img src=x onerror=alert(1)>',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('&amp; &quot;more&quot;')
  })

  it('a title with line breaks cannot break the subject line', () => {
    const email = outcomeEmail({ outcome: 'approved', ...page, title: 'Bus\r\nBcc: x@y.z' })
    expect(email.subject).not.toMatch(/[\r\n]/)
  })

  it('is an accessible HTML document: language set, one heading, descriptive link text', () => {
    const email = outcomeEmail({ outcome: 'approved', ...page })
    expect(email.html).toMatch(/^<!doctype html>/i)
    expect(email.html).toContain('<html lang="en">')
    expect(email.html.match(/<h1/g)).toHaveLength(1)
    expect(email.html).not.toMatch(/>\s*(click here|here)\s*</i)
  })

  it("never uses the platform's internal words (`04` §2.1)", () => {
    // The words, not the addresses: the page form's URL is `/admin/collections/…` and that is
    // Payload's route, not something the email says.
    for (const outcome of ['approved', 'changes-requested'] as const) {
      const email = outcomeEmail({ outcome, note: 'x', ...page })
      expect(
        `${email.subject} ${email.text}`.replace(/https?:\/\/\S+/g, '').toLowerCase(),
      ).not.toMatch(/draft|collection|tenant/)
    }
  })
})

/**
 * An announcement's outcome. Until the post template lands (Phase 5 part C) an announcement has
 * no address of its own, so the approval says so plainly and links nowhere rather than to a
 * page that does not show it.
 */
describe('outcomeEmail — an announcement', () => {
  const post = {
    noun: 'announcement' as const,
    title: 'Picture day',
    school: 'Oakbrook Elementary',
    pageUrl: null,
    editUrl: 'https://admin.dd2.org/admin/collections/posts/9',
  }

  it('approved: names it as an announcement and carries no website link', () => {
    const email = outcomeEmail({ outcome: 'approved', ...post })
    expect(email.subject).toBe('Your announcement is approved: Picture day')
    expect(email.text).toContain('approved your announcement “Picture day”')
    expect(email.text).toContain('Oakbrook Elementary')
    expect(email.html).not.toContain('href=')
    expect(email.text).not.toMatch(/https?:/)
  })

  it('changes requested: names it as an announcement and links to its form', () => {
    const email = outcomeEmail({ outcome: 'changes-requested', note: 'Add the time.', ...post })
    expect(email.text).toContain('your announcement “Picture day”')
    expect(email.html).toContain(`href="${post.editUrl}"`)
  })
})

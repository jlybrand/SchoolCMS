import { describe, expect, it } from 'vitest'

import { EMBED_HOST, toEmbedTarget } from '@/lib/embed-url'

/**
 * The embed URL normalizer (`02` §7, `07` §6, `03` §3.1).
 *
 * ============================================================================
 * THE ALLOWLIST APPLIES TO WHAT WE RENDER, NOT TO WHAT AN EDITOR TYPED.
 * ============================================================================
 *
 * `02` §7 and `07` §6 both say the same thing — domain allowlist, no free-form iframe source —
 * and the naive reading of that is a host check on the pasted string. This function does not
 * do that. It EXTRACTS the video id and REBUILDS the URL, so the rendered `src` is a string
 * this file constructed rather than one a person supplied. A host check alone would still be
 * putting attacker-influenced text into a frame source.
 *
 * The second reason is plain usability (`04` §2.1): a school manager pastes whatever the share
 * dialog gave them — a short link, a timestamped link, a whole `<iframe>` element. A validator
 * rejects all three and reads as broken software. A normalizer accepts them.
 *
 * Test-first per CLAUDE.md: this is a mapper, and it is the security boundary for the block.
 */

const ID = 'dQw4w9WgXcQ'
const embed = (id: string, params = '') => `https://${EMBED_HOST}/embed/${id}${params}`
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`

describe('toEmbedTarget — the shapes an editor actually pastes', () => {
  it('accepts a standard watch URL', () => {
    expect(toEmbedTarget(watch(ID))).toEqual({ src: embed(ID), href: watch(ID) })
  })

  it('accepts a youtu.be short link', () => {
    expect(toEmbedTarget(`https://youtu.be/${ID}`)?.src).toBe(embed(ID))
  })

  it('accepts an embed URL, including one already on the privacy host', () => {
    expect(toEmbedTarget(`https://www.youtube.com/embed/${ID}`)?.src).toBe(embed(ID))
    expect(toEmbedTarget(embed(ID))?.src).toBe(embed(ID))
  })

  /** Board meetings and graduations are streamed; the link YouTube gives afterwards is /live/. */
  it('accepts a live URL', () => {
    expect(toEmbedTarget(`https://www.youtube.com/live/${ID}`)?.src).toBe(embed(ID))
  })

  it('accepts a shorts URL', () => {
    expect(toEmbedTarget(`https://www.youtube.com/shorts/${ID}`)?.src).toBe(embed(ID))
  })

  it('accepts the mobile and bare-domain hosts', () => {
    expect(toEmbedTarget(`https://m.youtube.com/watch?v=${ID}`)?.src).toBe(embed(ID))
    expect(toEmbedTarget(`https://youtube.com/watch?v=${ID}`)?.src).toBe(embed(ID))
  })

  /**
   * "Copy embed code" is one of the two buttons in YouTube's share dialog, so half the people
   * who reach for it arrive with an element rather than a URL. Rejecting that is a support
   * ticket, and the `src` inside it is parsed by exactly the same rules as anything else.
   */
  it('accepts a whole iframe element pasted from the share dialog', () => {
    const markup = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${ID}?si=xyz" title="YouTube video player" allowfullscreen></iframe>`
    expect(toEmbedTarget(markup)?.src).toBe(embed(ID))
  })

  it('tolerates surrounding whitespace and a missing scheme', () => {
    expect(toEmbedTarget(`  ${watch(ID)}  `)?.src).toBe(embed(ID))
    expect(toEmbedTarget(`www.youtube.com/watch?v=${ID}`)?.src).toBe(embed(ID))
  })
})

describe('toEmbedTarget — the start time', () => {
  /** "Start at" is a checkbox in the share dialog, so the timestamp arrives on the URL. */
  it('carries a start time through as seconds', () => {
    expect(toEmbedTarget(`${watch(ID)}&t=90`)?.src).toBe(embed(ID, '?start=90'))
    expect(toEmbedTarget(`https://youtu.be/${ID}?t=90s`)?.src).toBe(embed(ID, '?start=90'))
  })

  it('understands the minutes-and-seconds form', () => {
    expect(toEmbedTarget(`${watch(ID)}&t=1m30s`)?.src).toBe(embed(ID, '?start=90'))
    expect(toEmbedTarget(`${watch(ID)}&t=1h2m3s`)?.src).toBe(embed(ID, '?start=3723'))
  })

  it('ignores a start time it cannot read rather than refusing the video', () => {
    expect(toEmbedTarget(`${watch(ID)}&t=soon`)?.src).toBe(embed(ID))
    expect(toEmbedTarget(`${watch(ID)}&t=-5`)?.src).toBe(embed(ID))
  })

  /**
   * Everything else on the URL is dropped. A playlist is a different affordance from a video
   * and `si=` is a share-tracking parameter — neither is something an editor chose to publish.
   */
  it('drops every other parameter, including playlists and share tracking', () => {
    expect(toEmbedTarget(`${watch(ID)}&list=PLabc&si=xyz&feature=share`)?.src).toBe(embed(ID))
  })
})

describe('toEmbedTarget — what it refuses', () => {
  it('refuses a host that is not YouTube', () => {
    for (const url of [
      'https://vimeo.com/123456789',
      'https://forms.office.com/r/abc',
      'https://example.test/embed/dQw4w9WgXcQ',
    ]) {
      expect(toEmbedTarget(url), url).toBeNull()
    }
  })

  /**
   * THE SUFFIX ATTACK. `endsWith('youtube.com')` and `includes('youtube.com')` both pass these,
   * which is why the host is matched exactly or as a subdomain and never as a substring.
   */
  it('refuses a host that merely contains the allowed one', () => {
    for (const host of [
      'youtube.com.evil.test',
      'notyoutube.com',
      'youtube.com.evil.test:443',
      'evil.test/www.youtube.com',
    ]) {
      expect(toEmbedTarget(`https://${host}/watch?v=${ID}`), host).toBeNull()
    }
  })

  it('refuses a non-http scheme', () => {
    for (const url of [
      `javascript:alert(1)//www.youtube.com/watch?v=${ID}`,
      `data:text/html,<iframe src="${watch(ID)}">`,
      `//www.youtube.com/watch?v=${ID}`,
    ]) {
      expect(toEmbedTarget(url), url).toBeNull()
    }
  })

  /**
   * Every YouTube id is eleven characters from a fixed alphabet. Any other length means this
   * function misparsed the URL, and a misparse must fail rather than build a frame source out
   * of whatever it found. If YouTube ever changes that, this test is where it surfaces.
   */
  it('refuses anything that is not a well-formed video id', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=',
      'https://www.youtube.com/watch?v=tooshort',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQextra',
      'https://www.youtube.com/watch?v=dQw4w9WgXc%2F',
      'https://www.youtube.com/',
      'https://youtu.be/',
    ]) {
      expect(toEmbedTarget(url), url).toBeNull()
    }
  })

  it('never throws, whatever it is handed', () => {
    for (const value of [null, undefined, '', '   ', 'not a url', '<iframe>', 'https://']) {
      expect(() => toEmbedTarget(value as string), String(value)).not.toThrow()
      expect(toEmbedTarget(value as string), String(value)).toBeNull()
    }
  })
})

describe('toEmbedTarget — the two URLs it returns', () => {
  /**
   * `src` is always the privacy host: no tracking cookie is set unless the visitor plays the
   * video. `03` §3.3 flags third-party tracking on pages visited by minors as a district
   * policy question — taking the privacy-preserving host by default keeps `Embed` out of it.
   */
  it('always renders through the no-cookie host', () => {
    expect(EMBED_HOST).toBe('www.youtube-nocookie.com')
    expect(toEmbedTarget(watch(ID))?.src.startsWith(`https://${EMBED_HOST}/`)).toBe(true)
  })

  /**
   * `href` is the canonical watch page, not the embed URL. It is the visible fallback `07` §6
   * requires: somewhere to go when the frame is blocked, fails, or is unusable — and an embed
   * URL opened as a page is a bare player with no title, description or captions menu.
   */
  it('points the fallback link at the watch page', () => {
    expect(toEmbedTarget(`https://youtu.be/${ID}?t=90`)?.href).toBe(watch(ID))
  })
})

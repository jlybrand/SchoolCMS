/**
 * Third-party embed URLs — normalized, then allowlisted (`02` §7, `07` §6).
 *
 * ============================================================================
 * THE ALLOWLIST APPLIES TO WHAT WE RENDER, NOT TO WHAT AN EDITOR TYPED.
 * ============================================================================
 *
 * `02` §7 and `07` §6 both require a domain allowlist and no free-form iframe source. The
 * naive way to satisfy that is a host check on the pasted string, and it is not enough: a
 * string that passes a host check is still a person's string going into a frame source. So
 * this module EXTRACTS the video id and REBUILDS the URL from constants below. What reaches
 * the `src` attribute is a string this file constructed.
 *
 * The second reason is plain usability (`04` §2.1). A school manager pastes whatever YouTube's
 * share dialog gave them — a short link, a timestamped link, or the whole `<iframe>` element,
 * since "copy embed code" is one of the two buttons on it. A validator refuses all three and
 * reads as broken software. A normalizer accepts them and publishes one canonical form.
 *
 * WHAT IS ALLOWED, AND WHY IT IS ONLY YOUTUBE (decided 2026-08-28). `03` §3.4 folded `Video`
 * into this block because YouTube is effectively DD2's only video source. `07` §6 requires a
 * current VPAT/ACR from any embedded vendor **before** allowlisting, so adding a host is a
 * procurement step and not a code change — schedule providers and Microsoft Forms are both
 * open items in `03` §3.3, not omissions here.
 */

/**
 * The host every embed renders through: YouTube's privacy-enhanced domain, which sets no
 * tracking cookie unless the visitor actually plays the video.
 *
 * Not an incidental choice. `03` §3.3 records third-party tracking on pages visited by minors
 * as a district policy question rather than a feature decision; taking the privacy-preserving
 * host by default keeps this block out of that conversation entirely.
 */
export const EMBED_HOST = 'www.youtube-nocookie.com'

/** Where the visible fallback link points (`07` §6). Always a watch page, never a frame URL. */
const WATCH_HOST = 'www.youtube.com'

/**
 * Accepted INPUT hosts. Matched exactly or as a subdomain — never as a substring, which is
 * what `endsWith`/`includes` would do and what makes `youtube.com.evil.test` pass.
 */
const ALLOWED_HOSTS: readonly string[] = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']

/**
 * Every YouTube video id is eleven characters from this alphabet. Any other length means this
 * module misparsed the URL — and a misparse must fail rather than build a frame source out of
 * whatever it happened to find. `tests/unit/embed-url.test.ts` is where a change would surface.
 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/** Path prefixes that carry the id in the next segment. `/watch` takes it from `?v=` instead. */
const ID_IN_PATH: readonly string[] = ['embed', 'live', 'shorts', 'v']

/** `1h2m3s`, `90s`, `90` — the forms YouTube's "start at" checkbox produces. */
const TIMESTAMP = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/

/** The `src` of a pasted `<iframe>` element. */
const IFRAME_SRC = /<iframe[^>]*\ssrc=["']([^"']+)["']/i

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export type EmbedTarget = {
  /** The frame source. Built here from `EMBED_HOST`, never from the input. */
  src: string
  /** The visible fallback link's destination — the canonical watch page (`07` §6). */
  href: string
}

const isAllowedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase()
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

/**
 * Parses to a URL, or null.
 *
 * A missing scheme is filled in, because an editor copying from the address bar can lose it.
 * A PROTOCOL-RELATIVE `//host/path` is refused rather than filled in: it is indistinguishable
 * from a path at a glance and is a standard way to smuggle a host past a naive check.
 */
const parse = (input: string): URL | null => {
  if (input.startsWith('//')) return null

  const withScheme = SCHEME.test(input) ? input : `https://${input}`

  try {
    const url = new URL(withScheme)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** Seconds, or null when the value is missing or unreadable. */
const startSeconds = (value: string | null): number | null => {
  if (value === null) return null

  const match = TIMESTAMP.exec(value.trim())
  if (!match) return null

  const [, hours, minutes, seconds] = match
  const total = Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0)

  // Zero is "from the beginning", which is what the player does anyway — so it is not a start.
  return total > 0 ? total : null
}

const videoIdFrom = (url: URL): string | null => {
  const segments = url.pathname.split('/').filter((segment) => segment !== '')

  // youtu.be/<id> — the whole path is the id.
  if (url.hostname.toLowerCase().replace(/^www\./, '') === 'youtu.be') {
    return segments[0] ?? null
  }

  if (segments[0] === 'watch') return url.searchParams.get('v')

  return segments[0] !== undefined && ID_IN_PATH.includes(segments[0])
    ? (segments[1] ?? null)
    : null
}

/**
 * An editor's pasted string -> the pair of URLs the block renders, or null if it is not an
 * allowlisted video.
 *
 * Returning null rather than throwing, for the reason `src/content/blocks.ts` gives: this runs
 * over content whose shape nobody can enforce, and the caller's answer to "not a video" is to
 * drop the block, never to fail a build.
 *
 * EVERYTHING ELSE ON THE URL IS DROPPED — playlists, `si=` share tracking, `feature=`. A
 * playlist is a different affordance from a video, and the rest is not something an editor
 * chose to publish.
 */
export const toEmbedTarget = (input: string | null | undefined): EmbedTarget | null => {
  if (typeof input !== 'string') return null

  const trimmed = input.trim()
  if (trimmed === '') return null

  /**
   * "Copy embed code" gives an element, not a URL. Its `src` then goes through the same rules.
   *
   * ONLY WHEN THE INPUT IS ACTUALLY MARKUP — it has to start with `<`. Searching any string
   * for an iframe would make `data:text/html,<iframe src="https://youtube.com/...">` extract a
   * legitimate URL out of a data URL and hand back a target, laundering the scheme check below.
   */
  const markup = trimmed.startsWith('<') ? IFRAME_SRC.exec(trimmed) : null
  const candidate = markup?.[1]?.trim() ?? trimmed

  const url = parse(candidate)
  if (!url || !isAllowedHost(url.hostname)) return null

  const id = videoIdFrom(url)
  if (id === null || !VIDEO_ID.test(id)) return null

  const start = startSeconds(url.searchParams.get('t') ?? url.searchParams.get('start'))

  return {
    src: `https://${EMBED_HOST}/embed/${id}${start === null ? '' : `?start=${start}`}`,
    href: `https://${WATCH_HOST}/watch?v=${id}`,
  }
}

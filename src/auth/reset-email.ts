/**
 * The forgot-password email's link, for the interim local-auth posture.
 *
 * ============================================================================
 * EXISTS ONLY BECAUSE WE ARE STORING PASSWORDS — deleted with local auth when Entra lands (see
 * the deviation note in CLAUDE.md).
 * ============================================================================
 *
 * Payload builds this link from `config.serverURL`. That is unset, deliberately: setting it also
 * switches on Payload's CSRF allowlist, which accepts the session cookie from that one origin only —
 * a separate decision. Without it Payload refuses, rightly, to trust the Host header (a forged one
 * would point a real reset link at someone else's site) and falls back to an EMPTY origin, so the
 * email carried `/admin/reset/<token>` and mail clients opened `http:///admin/reset/<token>`.
 *
 * So the link is built here from `NEXT_PUBLIC_SERVER_URL` — the district's public origin, already
 * what the digest email links from. Unset or malformed, it throws: a dead link mailed to a
 * locked-out school manager is worse than a failure the operator sees.
 */

export const resetPasswordLink = ({
  serverUrl,
  adminRoute,
  token,
}: {
  serverUrl: string | undefined
  adminRoute: string
  token: string
}): string => {
  let origin: string
  try {
    const url = new URL(serverUrl ?? '')
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error()
    origin = url.origin
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SERVER_URL must be the site's public origin (like https://dd2.example.org) to send a password reset link; got ${JSON.stringify(serverUrl ?? null)}.`,
    )
  }
  return `${origin}${adminRoute}/reset/${encodeURIComponent(token)}`
}

/** Payload's own wording, with a link that works. */
export const resetPasswordEmailHTML = (link: string): string =>
  `<p>You are receiving this because you (or someone else) asked to reset the password for your account.</p>
<p>Open this link to choose a new password: <a href="${link}">${link}</a></p>
<p>If you did not ask for this, ignore this email and your password will stay the same.</p>`

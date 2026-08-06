/**
 * Tenant resolution from the request hostname (`02` §4.1).
 *
 * `sms.district.org` -> tenant "summerville-ms"; apex `district.org` -> tenant "district".
 * Wildcard DNS plus wildcard TLS means **adding a tenant is data, not DevOps** — a row in
 * the `tenants` collection, no deploy (`09` §7).
 *
 * The lookup itself lives in the content-access layer (Phase 2) so the frontend never
 * touches Payload directly (`02` §11). This module holds only the pure normalization,
 * which is why it is unit-testable without a database.
 */

/**
 * Normalizes a Host header to a canonical hostname, or null if unusable.
 *
 * Returns null rather than a default: an unknown host must 404 or redirect to the district
 * (`02` §4.1). Falling back to a default tenant would serve one school's content on
 * another school's domain, which is a tenant-isolation failure the access layer would never
 * see, because it happens before scoping.
 */
export const normalizeHostname = (host: string | null | undefined): string | null => {
  if (typeof host !== 'string') return null

  const trimmed = host.trim().toLowerCase()
  if (trimmed === '') return null

  // IPv6 literals are bracketed: [::1] or [::1]:3000. Strip only a port after the bracket.
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close === -1) return null
    const literal = trimmed.slice(0, close + 1)
    return literal === '[]' ? null : literal
  }

  const withoutPort = trimmed.split(':')[0] ?? ''
  // A fully-qualified name may carry a trailing dot; it is the same host.
  const withoutTrailingDot = withoutPort.endsWith('.') ? withoutPort.slice(0, -1) : withoutPort

  return withoutTrailingDot === '' ? null : withoutTrailingDot
}

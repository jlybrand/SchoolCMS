/**
 * A URL on a tenant's public site, on the SAME port as the server under test.
 *
 * Tenants are told apart by hostname (`a.localhost`), so a spec cannot just use a relative path.
 * A hard-coded `:3000` silently checked whatever else was listening there — a developer's
 * `next dev` — whenever the run used another port (`PORT=3100`).
 */
export const siteUrl = (baseURL: string | undefined, hostname: string, path = '/') => {
  const url = new URL(baseURL ?? 'http://localhost:3000')
  url.hostname = hostname
  url.pathname = path.startsWith('/') ? path : `/${path}`
  return url.toString()
}

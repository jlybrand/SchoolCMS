import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Fetching a feed calendar's address from the server (Jason, 2026-11-11). The address is typed by
 * a district admin, so this is where a request forgery would happen: only `https`, every host
 * RESOLVED and checked before connecting, redirects followed by hand and checked again.
 *
 * DNS and fetch are replaced, so nothing leaves the machine.
 */

const lookup = vi.fn()
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookup(...args) }))

const { fetchPublicFeed } = await import('@/jobs/calendar-feeds')

const CALENDAR = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  lookup.mockImplementation(async () => [{ address: '142.250.72.14', family: 4 }])
})

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  lookup.mockReset()
})

describe('fetchPublicFeed', () => {
  it('fetches a public https address, without following redirects on its own', async () => {
    fetchMock.mockResolvedValue(new Response(CALENDAR, { status: 200 }))
    expect(await fetchPublicFeed('https://calendar.google.com/x.ics')).toBe(CALENDAR)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://calendar.google.com/x.ics',
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('refuses a public-looking name that resolves into the server’s own network', async () => {
    lookup.mockResolvedValue([{ address: '10.0.0.7', family: 4 }])
    await expect(fetchPublicFeed('https://intranet.example.org/x.ics')).rejects.toThrow(
      /public internet/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a name with ANY private address among its answers', async () => {
    lookup.mockResolvedValue([
      { address: '142.250.72.14', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    await expect(fetchPublicFeed('https://mixed.example.org/x.ics')).rejects.toThrow(
      /public internet/,
    )
  })

  it('checks a redirect’s target too — it cannot lead into the server’s own network', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } }),
    )
    await expect(fetchPublicFeed('https://example.org/x.ics')).rejects.toThrow(/public internet/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows a public redirect', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { location: '/moved.ics' } }),
      )
      .mockResolvedValueOnce(new Response(CALENDAR, { status: 200 }))
    expect(await fetchPublicFeed('https://example.org/x.ics')).toBe(CALENDAR)
    expect(fetchMock).toHaveBeenLastCalledWith('https://example.org/moved.ics', expect.anything())
  })

  it('gives up after three redirects', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: '/again.ics' } }),
    )
    await expect(fetchPublicFeed('https://example.org/x.ics')).rejects.toThrow(
      /redirected too many times/,
    )
  })

  it('says what went wrong in words a district admin can act on', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await expect(fetchPublicFeed('https://example.org/x.ics')).rejects.toThrow(/Nothing was found/)
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    await expect(fetchPublicFeed('https://example.org/x.ics')).rejects.toThrow(
      /error \(403\)\. Check the calendar is public/,
    )
    lookup.mockRejectedValueOnce(new Error('ENOTFOUND'))
    await expect(fetchPublicFeed('https://nowhere.example.org/x.ics')).rejects.toThrow(
      /could not be found/,
    )
  })

  it('refuses a calendar over 5 MB', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(5 * 1024 * 1024 + 1), { status: 200 }))
    await expect(fetchPublicFeed('https://example.org/x.ics')).rejects.toThrow(/too large/)
  })

  it('refuses plain http before resolving anything', async () => {
    await expect(fetchPublicFeed('http://example.org/x.ics')).rejects.toThrow(/https/)
    expect(lookup).not.toHaveBeenCalled()
  })
})

import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * A calendar on a page (Jason, 2026-11-11): the district puts School B's calendar on a page as a
 * list and as a month grid. Clicking an event reveals its notes — under it in the list, in a
 * dialog in the grid — and the page has no blocking axe violation with either open.
 *
 * Repeats, ranges and the resolve pass are proven in the unit and integration suites; this
 * drives a real page, with its script.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

const notesOf = (text: string) => ({
  root: {
    type: 'root',
    direction: null,
    format: '',
    indent: 0,
    version: 1,
    children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', text, version: 1 }] }],
  },
})

const asDistrict = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })

const mainCalendarOf = async (admin: APIRequestContext, tenant: number) => {
  const res = await admin.get(
    `/api/calendars?where[tenant][equals]=${tenant}&where[isMain][equals]=true&limit=1&depth=0`,
  )
  return ((await res.json()).docs as { id: number }[])[0]!.id
}

type Fixture = {
  admin: APIRequestContext
  page: number
  event: number
  slug: string
  calendar: number
}

/** A published event tomorrow on School B's calendar, and a page showing it both ways. */
const setUp = async (
  baseURL: string | undefined,
  title: string,
  notes: string,
): Promise<Fixture> => {
  const admin = await asDistrict(baseURL)
  const tenant = await tenantIdFor(admin, 'b.localhost')
  const calendar = await mainCalendarOf(admin, tenant)
  const start = new Date(Date.now() + 26 * 60 * 60 * 1000)
  const made = await admin.post('/api/events?depth=0', {
    data: {
      tenant,
      calendar,
      title,
      start: start.toISOString(),
      end: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      location: 'Media center',
      notes: notesOf(notes),
      _status: 'published',
    },
  })
  expect(made.ok(), await made.text()).toBe(true)
  const slug = `calendar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const page = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Our calendar'),
      slug,
      visibility: 'public',
      layout: [
        { blockType: 'calendar', heading: 'Upcoming events', calendars: [calendar], limit: 50 },
        { blockType: 'calendar', heading: 'Month view', calendars: [calendar], display: 'grid' },
      ],
      _status: 'published',
    },
  })
  expect(page.ok(), await page.text()).toBe(true)
  return {
    admin,
    calendar,
    page: ((await page.json()).doc as { id: number }).id,
    event: ((await made.json()).doc as { id: number }).id,
    slug,
  }
}

const tearDown = async ({ admin, page, event }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  await admin.delete(`/api/events/${event}`)
  await admin.dispose()
}

const open = async (page: Page, baseURL: string | undefined, slug: string) =>
  expect(async () => {
    await page.goto(siteUrl(baseURL, 'b.localhost', `/${slug}`))
    await expect(page.getByRole('region', { name: 'Upcoming events' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })

/** The event's button in the grid — tomorrow may be in next month. */
const gridEvent = async (page: Page, title: string) => {
  const grid = page.getByRole('region', { name: 'Month view' })
  const button = grid.getByRole('table').getByRole('button', { name: title })
  if ((await button.count()) === 0) await grid.getByRole('button', { name: 'Next month' }).click()
  return button
}

const blocking = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations.filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))

test.describe('a calendar on a page', () => {
  test.skip(credentials === null, SKIP)

  test('@smoke the list shows the event; clicking it reveals its notes', async ({
    page,
    baseURL,
  }) => {
    const title = uniqueTitle('Book fair')
    const notes = 'Cash and cards accepted.'
    const f = await setUp(baseURL, title, notes)
    try {
      await open(page, baseURL, f.slug)
      const list = page.getByRole('region', { name: 'Upcoming events' })
      const entry = list.getByRole('listitem').filter({ hasText: title })
      await expect(entry.getByText('Media center')).toBeVisible()
      await expect(entry.getByText(notes)).toBeHidden()
      await entry.getByText(title).click()
      await expect(entry.getByText(notes)).toBeVisible()
    } finally {
      await tearDown(f)
    }
  })

  test('the grid: clicking an event opens its details; Escape closes and returns focus', async ({
    page,
    baseURL,
  }) => {
    const title = uniqueTitle('Science night')
    const notes = 'Projects judged at 7.'
    const f = await setUp(baseURL, title, notes)
    try {
      await open(page, baseURL, f.slug)
      const button = await gridEvent(page, title)
      await button.click()
      const dialog = page.getByRole('dialog', { name: title })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(notes)).toBeVisible()
      await expect(dialog.getByText('Media center')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(button).toBeFocused()
    } finally {
      await tearDown(f)
    }
  })

  test('each calendar has a subscribe link, and its iCal feed is served on its own site only', async ({
    page,
    baseURL,
    request,
  }) => {
    const title = uniqueTitle('Choir concert')
    const f = await setUp(baseURL, title, 'In the gym.')
    try {
      await open(page, baseURL, f.slug)
      const link = page
        .getByRole('region', { name: 'Upcoming events' })
        .getByRole('link', { name: /^Subscribe to / })
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`^webcal://b\\.localhost(:\\d+)?/calendars/${f.calendar}\\.ics$`),
      )

      const feedUrl = siteUrl(baseURL, 'b.localhost', `/calendars/${f.calendar}.ics`)
      await expect(async () => {
        const res = await request.get(feedUrl)
        expect(res.status()).toBe(200)
        expect(res.headers()['content-type']).toContain('text/calendar')
        const body = await res.text()
        expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
        expect(body.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`)
      }).toPass({ timeout: 15_000 })

      // Another site does not serve School B's calendar.
      const elsewhere = await request.get(
        siteUrl(baseURL, 'a.localhost', `/calendars/${f.calendar}.ics`),
      )
      expect(elsewhere.status()).toBe(404)
    } finally {
      await tearDown(f)
    }
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`@a11y no critical or serious axe violations, notes and dialog open — ${colorScheme}`, async ({
      page,
      baseURL,
    }) => {
      const title = uniqueTitle('Open house')
      const f = await setUp(baseURL, title, 'Tours every half hour.')
      try {
        await page.emulateMedia({ colorScheme })
        await open(page, baseURL, f.slug)
        expect(await blocking(page)).toEqual([])

        const list = page.getByRole('region', { name: 'Upcoming events' })
        await list.getByRole('listitem').filter({ hasText: title }).getByText(title).click()
        expect(await blocking(page)).toEqual([])

        await (await gridEvent(page, title)).click()
        await expect(page.getByRole('dialog', { name: title })).toBeVisible()
        expect(await blocking(page)).toEqual([])
      } finally {
        await tearDown(f)
      }
    })
  }
})

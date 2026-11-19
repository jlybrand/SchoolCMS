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

  test('one calendar: Subscribe offers its own feed, and its iCal feed is served on its own site only', async ({
    page,
    baseURL,
    request,
  }) => {
    const title = uniqueTitle('Choir concert')
    const f = await setUp(baseURL, title, 'In the gym.')
    try {
      await open(page, baseURL, f.slug)
      await page
        .getByRole('region', { name: 'Upcoming events' })
        .getByRole('button', { name: /^Subscribe to / })
        .click()
      const link = page.getByRole('dialog', { name: /^Subscribe to / }).getByRole('link', {
        name: 'Apple Calendar',
      })
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

  test(`@a11y no critical or serious axe violations, notes and dialog open`, async ({
    page,
    baseURL,
  }) => {
    const title = uniqueTitle('Open house')
    const f = await setUp(baseURL, title, 'Tours every half hour.')
    try {
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
})

/**
 * FILTER AND PRINT (Jason, 2026-11-18): a block pulling in School B's and the district's calendars
 * offers "Filter calendars" — a dialog, every calendar on at first — and "Print", which prints this
 * calendar as it is on screen and nothing else of the page. Built, then locked here (the
 * filtering itself is `tests/unit/lib/calendar-filter.test.ts`).
 */
test.describe('a calendar of several calendars', () => {
  test.skip(credentials === null, SKIP)

  type Several = {
    admin: APIRequestContext
    page: number
    events: number[]
    slug: string
    schoolName: string
    districtName: string
  }

  const setUpSeveral = async (
    baseURL: string | undefined,
    schoolTitle: string,
    districtTitle: string,
  ): Promise<Several> => {
    const admin = await asDistrict(baseURL)
    const school = await tenantIdFor(admin, 'b.localhost')
    const district = await tenantIdFor(admin, 'localhost')
    const schoolCalendar = await mainCalendarOf(admin, school)
    const districtCalendar = await mainCalendarOf(admin, district)
    const nameOf = async (id: number) =>
      ((await (await admin.get(`/api/calendars/${id}?depth=0`)).json()) as { name: string }).name
    const start = new Date(Date.now() + 26 * 60 * 60 * 1000)
    const events: number[] = []
    for (const [tenant, calendar, title] of [
      [school, schoolCalendar, schoolTitle],
      [district, districtCalendar, districtTitle],
    ] as const) {
      const made = await admin.post('/api/events?depth=0', {
        data: { tenant, calendar, title, start: start.toISOString(), _status: 'published' },
      })
      expect(made.ok(), await made.text()).toBe(true)
      events.push(((await made.json()).doc as { id: number }).id)
    }
    const slug = `calendars-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const both = [schoolCalendar, districtCalendar]
    const page = await admin.post('/api/pages?depth=0', {
      data: {
        tenant: school,
        title: uniqueTitle('Our calendars'),
        slug,
        visibility: 'public',
        layout: [
          { blockType: 'calendar', heading: 'Upcoming events', calendars: both, limit: 50 },
          { blockType: 'calendar', heading: 'Month view', calendars: both, display: 'grid' },
        ],
        _status: 'published',
      },
    })
    expect(page.ok(), await page.text()).toBe(true)
    return {
      admin,
      events,
      slug,
      page: ((await page.json()).doc as { id: number }).id,
      schoolName: await nameOf(schoolCalendar),
      districtName: await nameOf(districtCalendar),
    }
  }

  const tearDownSeveral = async ({ admin, page, events }: Several) => {
    await admin.delete(`/api/pages/${page}`)
    for (const id of events) await admin.delete(`/api/events/${id}`)
    await admin.dispose()
  }

  test('@a11y Filter calendars: a dialog, all on; turning one off hides its events in that block only', async ({
    page,
    baseURL,
  }) => {
    const schoolTitle = uniqueTitle('Spirit night')
    const districtTitle = uniqueTitle('Board work session')
    const f = await setUpSeveral(baseURL, schoolTitle, districtTitle)
    try {
      await open(page, baseURL, f.slug)
      const list = page.getByRole('region', { name: 'Upcoming events' })
      await expect(list.getByText(schoolTitle)).toBeVisible()
      await expect(list.getByText(districtTitle)).toBeVisible()

      const filter = list.getByRole('button', { name: 'Filter calendars' })
      await filter.click()
      const dialog = page.getByRole('dialog', { name: 'Calendars to show' })
      await expect(dialog).toBeVisible()
      const districtBox = dialog.getByRole('checkbox', { name: f.districtName })
      await expect(dialog.getByRole('checkbox', { name: f.schoolName })).toBeChecked()
      await expect(districtBox).toBeChecked()
      expect(await blocking(page)).toEqual([])

      await districtBox.uncheck()
      await expect(list.getByText(districtTitle)).toBeHidden()
      await expect(list.getByText(schoolTitle)).toBeVisible()
      await expect(list.getByText('Showing 1 of 2 calendars')).toBeAttached()
      await dialog.getByRole('button', { name: 'Done' }).click()
      await expect(dialog).toBeHidden()
      await expect(filter).toBeFocused()

      // The month view is its own block, with its own choice: still both.
      const grid = page.getByRole('region', { name: 'Month view' })
      const inGrid = async (title: string) => {
        const button = grid.getByRole('table').getByRole('button', { name: title })
        if ((await button.count()) === 0)
          await grid.getByRole('button', { name: 'Next month' }).click()
        return button
      }
      await expect(await inGrid(districtTitle)).toBeVisible()

      // Both off: the list says so rather than vanishing.
      await filter.click()
      await dialog.getByRole('checkbox', { name: f.schoolName }).uncheck()
      await expect(list.getByText('No events from the chosen calendars.')).toBeVisible()
      await dialog.getByRole('button', { name: 'Show all' }).click()
      await expect(list.getByText(districtTitle)).toBeVisible()
      expect(await blocking(page)).toEqual([])
    } finally {
      await tearDownSeveral(f)
    }
  })

  test('@a11y ONE Subscribe, following the filter: Apple, Google, Outlook or the iCal address of one feed', async ({
    page,
    baseURL,
    request,
  }) => {
    const schoolTitle = uniqueTitle('Art show')
    const districtTitle = uniqueTitle('Board retreat')
    const f = await setUpSeveral(baseURL, schoolTitle, districtTitle)
    try {
      await open(page, baseURL, f.slug)
      const list = page.getByRole('region', { name: 'Upcoming events' })
      const subscribe = list.getByRole('button', { name: /^Subscribe to / })
      await expect(subscribe).toHaveCount(1)
      await expect(subscribe).toHaveAccessibleName('Subscribe to these 2 calendars')
      await subscribe.click()
      const where = page.getByRole('dialog', { name: 'Subscribe to these 2 calendars' })
      await expect(where).toBeVisible()
      // Jason (2026-11-19): standard iCal, Google, Outlook, Apple — all the same one feed.
      const apple = where.getByRole('link', { name: 'Apple Calendar' })
      const href = (await apple.getAttribute('href'))!
      await expect(where.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute(
        'href',
        `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(href)}`,
      )
      await expect(where.getByRole('link', { name: 'Outlook.com' })).toHaveAttribute(
        'href',
        /^https:\/\/outlook\.live\.com\/calendar\/0\/addfromweb\?url=/,
      )
      await expect(where.getByRole('link', { name: 'Outlook (Microsoft 365)' })).toHaveAttribute(
        'href',
        /^https:\/\/outlook\.office\.com\/calendar\/0\/addfromweb\?url=/,
      )
      await expect(where.getByRole('textbox', { name: /^iCal feed address/ })).toHaveValue(
        href.replace(/^webcal:/, 'http:'),
      )
      expect(await blocking(page)).toEqual([])
      await where.getByRole('button', { name: 'Done' }).click()
      await expect(subscribe).toBeFocused()
      const ids = /^webcal:\/\/b\.localhost(?::\d+)?\/calendars\/(\d+)-(\d+)\.ics$/.exec(href)
      expect(ids, href).not.toBeNull()
      expect(Number(ids![1])).toBeLessThan(Number(ids![2]))

      // The one feed holds both calendars' events, on this page's site.
      const feedPath = new URL(href.replace(/^webcal:/, 'http:')).pathname
      await expect(async () => {
        const res = await request.get(siteUrl(baseURL, 'b.localhost', feedPath))
        expect(res.status()).toBe(200)
        const body = (await res.text()).replace(/\r\n /g, '')
        expect(body).toContain(`SUMMARY:${schoolTitle}`)
        expect(body).toContain(`SUMMARY:${districtTitle}`)
      }).toPass({ timeout: 15_000 })
      // Only the one address of the set: the same ids the other way round are not one.
      const reversed = await request.get(
        siteUrl(baseURL, 'b.localhost', `/calendars/${ids![2]}-${ids![1]}.ics`),
      )
      expect(reversed.status()).toBe(404)

      // The district's calendar off: the link is School B's own feed.
      await list.getByRole('button', { name: 'Filter calendars' }).click()
      const dialog = page.getByRole('dialog', { name: 'Calendars to show' })
      await dialog.getByRole('checkbox', { name: f.districtName }).uncheck()
      await dialog.getByRole('button', { name: 'Done' }).click()
      await expect(subscribe).toHaveAccessibleName(`Subscribe to ${f.schoolName}`)
      await subscribe.click()
      await expect(
        page
          .getByRole('dialog', { name: `Subscribe to ${f.schoolName}` })
          .getByRole('link', { name: 'Apple Calendar' }),
      ).toHaveAttribute('href', /\/calendars\/\d+\.ics$/)
    } finally {
      await tearDownSeveral(f)
    }
  })

  test('Print prints this calendar as it is on screen, and nothing else of the page', async ({
    page,
    baseURL,
  }) => {
    // The browser's print dialog cannot be driven: record what is marked when it would open.
    await page.addInitScript(() => {
      ;(window as unknown as { printedMarked: boolean | null }).printedMarked = null
      window.print = () => {
        ;(window as unknown as { printedMarked: boolean | null }).printedMarked =
          document.querySelectorAll('[data-calendar-printing]').length === 1
      }
    })
    const schoolTitle = uniqueTitle('Picture day')
    const districtTitle = uniqueTitle('Budget hearing')
    const f = await setUpSeveral(baseURL, schoolTitle, districtTitle)
    try {
      await open(page, baseURL, f.slug)
      const list = page.getByRole('region', { name: 'Upcoming events' })
      await list.getByRole('button', { name: 'Filter calendars' }).click()
      const dialog = page.getByRole('dialog', { name: 'Calendars to show' })
      await dialog.getByRole('checkbox', { name: f.districtName }).uncheck()
      await dialog.getByRole('button', { name: 'Done' }).click()

      await list.getByRole('button', { name: 'Print this calendar' }).click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { printedMarked: unknown }).printedMarked),
        )
        .toBe(true)

      // On paper: this calendar, filtered, without its buttons; not the site's header, nor the
      // page's other calendar.
      await page.emulateMedia({ media: 'print' })
      await expect(list.getByText(schoolTitle)).toBeVisible()
      await expect(list.getByText(districtTitle)).toBeHidden()
      await expect(list.getByRole('button', { name: 'Print this calendar' })).toBeHidden()
      await expect(page.getByRole('region', { name: 'Month view' })).toBeHidden()
      await expect(page.locator('header').first()).toBeHidden()

      // When the print dialog closes, the page is the page again.
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
      await expect(page.locator('[data-calendar-printing]')).toHaveCount(0)
      await expect(page.getByRole('region', { name: 'Month view' })).toBeVisible()
    } finally {
      await tearDownSeveral(f)
    }
  })
})

/**
 * Choosing a block's calendars (Jason, 2026-11-19: "swap for checkboxes"): every calendar as a
 * checkbox under its site, so it is plain that a block takes several. Ticking one adds it to the
 * block; the save stores the same relationship Payload's own field did.
 */
test.describe('choosing a calendar block’s calendars', () => {
  test.skip(credentials === null, SKIP)
  test.use({ storageState: ADMIN_STORAGE_STATE })

  test('@a11y checkboxes by site; ticking a second calendar adds it to the block', async ({
    page,
    baseURL,
  }) => {
    const admin = await asDistrict(baseURL)
    const school = await tenantIdFor(admin, 'b.localhost')
    const district = await tenantIdFor(admin, 'localhost')
    const schoolCalendar = await mainCalendarOf(admin, school)
    const districtCalendar = await mainCalendarOf(admin, district)
    const nameOf = async (id: number) =>
      ((await (await admin.get(`/api/calendars/${id}?depth=0`)).json()) as { name: string }).name
    const made = await admin.post('/api/pages?depth=0', {
      data: {
        tenant: school,
        title: uniqueTitle('Calendars chosen'),
        slug: `calendars-chosen-${Date.now()}`,
        visibility: 'public',
        layout: [{ blockType: 'calendar', heading: 'Events', calendars: [schoolCalendar] }],
        _status: 'published',
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const id = ((await made.json()).doc as { id: number }).id
    try {
      await page.goto(`/admin/collections/pages/${id}`)
      const field = page.getByRole('group', { name: /^Calendars/ })
      await expect(field).toBeVisible({ timeout: 20_000 })
      const districtSite = field.getByRole('group', { name: 'DD2 District' })
      const districtName = await nameOf(districtCalendar)
      await expect(
        field.getByRole('checkbox', { name: await nameOf(schoolCalendar) }).first(),
      ).toBeChecked()
      const districtBox = districtSite.getByRole('checkbox', { name: districtName })
      await expect(districtBox).not.toBeChecked()
      await expect(page.locator('#field-layout__0__calendars .rs__control')).toHaveCount(0)
      expect(await blocking(page)).toEqual([])

      await districtBox.check()
      // Autosaved as the page's newest version.
      await expect
        .poll(
          async () => {
            const draft = (await (
              await admin.get(`/api/pages/${id}?draft=true&depth=0`)
            ).json()) as { layout?: { calendars?: number[] }[] }
            return draft.layout?.[0]?.calendars
          },
          { timeout: 20_000 },
        )
        .toEqual([schoolCalendar, districtCalendar])
    } finally {
      await admin.delete(`/api/pages/${id}`)
      await admin.dispose()
    }
  })
})

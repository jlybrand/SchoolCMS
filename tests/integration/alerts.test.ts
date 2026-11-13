import type { Payload } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import { getAlerts } from '@/content/alerts'
import { getTenantByHostname } from '@/content/tenants'
import type { ContentContext } from '@/content/types'

import { getTestPayload, seed, type Fixtures } from '../helpers/payload'

/**
 * Alert banners over the real stack (Jason, 2026-11-12): the district's only, every route; a
 * template's blanks filled and its message stored; free text only with its extra confirmation;
 * and the public read shows each alert exactly where it was placed.
 */

let payload: Payload
let f: Fixtures

beforeAll(async () => {
  payload = await getTestPayload()
  f = await seed(payload)
}, 120_000)

const HOUR = 60 * 60 * 1000
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString()

const ctxFor = async (hostname: string): Promise<ContentContext> => {
  const tenant = await getTenantByHostname(hostname)
  if (!tenant) throw new Error(`no tenant ${hostname}`)
  return { tenant, locale: 'en' }
}

const asDistrict = (data: Record<string, unknown>) =>
  payload.create({
    collection: 'alerts',
    data: data as never,
    user: f.districtAdmin,
    overrideAccess: false,
  })

const closure = (over: Record<string, unknown> = {}) => ({
  kind: 'template',
  template: 'closure',
  date: 'Tuesday',
  reason: 'snow',
  siteScope: 'all',
  pageScope: 'every',
  ...over,
})

describe('who may post', () => {
  it('the district', async () => {
    const made = await asDistrict(closure())
    expect(made).toMatchObject({
      severity: 'emergency',
      text: 'Schools are closed on Tuesday because of snow.',
    })
  })

  it('never a school manager, nor anyone signed out', async () => {
    await expect(
      payload.create({
        collection: 'alerts',
        data: closure() as never,
        user: f.managerA,
        overrideAccess: false,
      }),
    ).rejects.toThrow()
    // Reading is refused outright — Payload throws on a read its access denies.
    await expect(
      payload.find({ collection: 'alerts', user: f.managerA, overrideAccess: false }),
    ).rejects.toThrow(/not allowed/i)
    await expect(payload.find({ collection: 'alerts', overrideAccess: false })).rejects.toThrow(
      /not allowed/i,
    )
  })
})

describe('what an alert says', () => {
  it('a template’s blanks must be filled — the empty one is named', async () => {
    await expect(asDistrict(closure({ reason: '' }))).rejects.toThrow(/reason/i)
  })

  it('free text needs its message, a severity, and the extra confirmation', async () => {
    const custom = {
      kind: 'custom',
      message: 'Picture day moves to Friday.',
      severity: 'info',
      siteScope: 'all',
      pageScope: 'every',
    }
    await expect(asDistrict(custom)).rejects.toThrow(/confirm/i)
    const made = await asDistrict({ ...custom, confirmCustom: true })
    expect(made).toMatchObject({ severity: 'info', text: 'Picture day moves to Friday.' })
  })
})

describe('getAlerts — where each shows', () => {
  it('by level: an elementary alert reaches an elementary school, not a middle one', async () => {
    await payload.update({
      collection: 'tenants',
      id: f.tenantA,
      data: { gradesServed: { elementary: true, middle: false, high: false } } as never,
      overrideAccess: true,
    })
    await payload.update({
      collection: 'tenants',
      id: f.tenantB,
      data: { gradesServed: { elementary: false, middle: true, high: false } } as never,
      overrideAccess: true,
    })
    const made = await asDistrict(
      closure({ siteScope: 'level', levels: { elementary: true }, reason: 'level test' }),
    )
    const onA = await getAlerts(await ctxFor('a.localhost'), null)
    const onB = await getAlerts(await ctxFor('b.localhost'), null)
    expect(onA.map((a) => a.id)).toContain(String(made.id))
    expect(onB.map((a) => a.id)).not.toContain(String(made.id))
  })

  it('chosen sites, home pages only', async () => {
    const made = await asDistrict(
      closure({ siteScope: 'chosen', sites: [f.tenantB], pageScope: 'home', reason: 'homes' }),
    )
    const id = String(made.id)
    const b = await ctxFor('b.localhost')
    expect((await getAlerts(b, { id: '1', isHome: true })).map((a) => a.id)).toContain(id)
    expect((await getAlerts(b, { id: '2', isHome: false })).map((a) => a.id)).not.toContain(id)
    expect(
      (await getAlerts(await ctxFor('a.localhost'), { id: '1', isHome: true })).map((a) => a.id),
    ).not.toContain(id)
  })

  it('only between its start and end', async () => {
    const later = await asDistrict(closure({ startAt: at(2), reason: 'later' }))
    const over = await asDistrict(closure({ endAt: at(-1), startAt: at(-3), reason: 'over' }))
    const ids = (await getAlerts(await ctxFor('a.localhost'), null)).map((a) => a.id)
    expect(ids).not.toContain(String(later.id))
    expect(ids).not.toContain(String(over.id))
  })

  it('gives the banner what it needs: severity, words, link, whether it can be closed', async () => {
    const made = await asDistrict(
      closure({
        kind: 'template',
        template: 'weather',
        expected: 'heavy rain this afternoon',
        linkUrl: 'https://example.org/weather',
        linkLabel: 'Forecast',
      }),
    )
    const alert = (await getAlerts(await ctxFor('a.localhost'), null)).find(
      (a) => a.id === String(made.id),
    )
    expect(alert).toEqual({
      id: String(made.id),
      severity: 'info',
      text: 'Weather advisory: heavy rain this afternoon.',
      link: { href: 'https://example.org/weather', label: 'Forecast' },
      dismissible: true,
      version: expect.any(String),
    })
  })
})

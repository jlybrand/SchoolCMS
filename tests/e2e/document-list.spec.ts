import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { tinyPdf } from '../helpers/files'

import { ADMIN_STORAGE_STATE, adminCredentials } from './support/admin-session'
import { uniqueTitle } from './support/fixture-pages'
import { tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Document list block on a public page (Jason, 2026-11-16): one folder's documents, A–Z, each
 * link naming its type and size; one not checked for accessibility carries the note offering an
 * accessible copy (`07` §5). The rules are `tests/integration/document-list.test.ts`; the
 * component's own axe, LTR and RTL, is the Storybook gate.
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'
const BLOCKING = ['critical', 'serious']
const HOST = 'b.localhost'

const blockingViolations = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => BLOCKING.includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

type Fixture = {
  admin: APIRequestContext
  page: number
  folder: number
  files: number[]
  slug: string
}

const upload = async (admin: APIRequestContext, data: Record<string, unknown>): Promise<number> => {
  const pdf = tinyPdf()
  const res = await admin.post('/api/resources?depth=0', {
    multipart: {
      file: { name: pdf.name, mimeType: pdf.mimetype, buffer: pdf.data },
      _payload: JSON.stringify(data),
    },
  })
  expect(res.ok(), await res.text()).toBe(true)
  return ((await res.json()).doc as { id: number }).id
}

const setUp = async (baseURL: string | undefined): Promise<Fixture> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, HOST)
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  const madeFolder = await admin.post('/api/resource-folders?depth=0', {
    data: { tenant, name: `Forms ${stamp}` },
  })
  expect(madeFolder.ok(), await madeFolder.text()).toBe(true)
  const folder = ((await madeFolder.json()).doc as { id: number }).id

  const files = [
    await upload(admin, {
      tenant,
      folder,
      title: 'Bus request',
      description: 'Return it to the front office.',
      remediationStatus: 'attested',
    }),
    await upload(admin, {
      tenant,
      folder,
      title: 'Allergy plan',
      remediationStatus: 'not-attested',
    }),
  ]

  const slug = `forms-${stamp}`
  const made = await admin.post('/api/pages?depth=0', {
    data: {
      tenant,
      title: uniqueTitle('Forms'),
      slug,
      visibility: 'public',
      layout: [{ blockType: 'documentList', heading: 'Enrollment forms', folder }],
      _status: 'published',
    },
  })
  expect(made.ok(), await made.text()).toBe(true)
  return { admin, page: ((await made.json()).doc as { id: number }).id, folder, files, slug }
}

const tearDown = async ({ admin, page, folder, files }: Fixture) => {
  await admin.delete(`/api/pages/${page}`)
  for (const id of files) await admin.delete(`/api/resources/${id}`)
  await admin.delete(`/api/resource-folders/${folder}`)
  await admin.dispose()
}

test.describe('a document list on a page', () => {
  test.skip(credentials === null, SKIP)

  test(`@a11y a folder’s documents, A–Z, with the note on the unchecked one`, async ({
    page,
    baseURL,
  }) => {
    const fixture = await setUp(baseURL)
    try {
      await expect(async () => {
        await page.goto(siteUrl(baseURL, HOST, `/${fixture.slug}`))
        await expect(page.getByRole('heading', { name: 'Enrollment forms' })).toBeVisible({
          timeout: 1_000,
        })
      }).toPass({ timeout: 15_000 })

      // A named region at the block's level, under the page's own title.
      const region = page.getByRole('region', { name: 'Enrollment forms' })
      await expect(page.getByRole('heading', { name: 'Enrollment forms', level: 2 })).toBeVisible()

      // A–Z; each link says what it opens.
      const links = region.getByRole('link')
      await expect(links).toHaveText([
        /^Allergy plan \(PDF, \d+ KB\)$/,
        /^Bus request \(PDF, \d+ KB\)$/,
      ])
      await expect(links.first()).toHaveAttribute('href', /^\/api\/resources\/file\//)

      // The note only on the one nobody has checked.
      const items = region.getByRole('listitem')
      await expect(items.nth(0)).toContainText('may not be fully accessible')
      await expect(items.nth(1)).not.toContainText('may not be fully accessible')
      await expect(items.nth(1)).toContainText('Return it to the front office.')

      expect(await blockingViolations(page)).toEqual([])
    } finally {
      await tearDown(fixture)
    }
  })
})

import AxeBuilder from '@axe-core/playwright'
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { ADMIN_STORAGE_STATE } from './admin-session'
import { SCHOOL_HOSTNAME, SCHOOL_STORAGE_STATE, tenantIdFor } from './school-session'

/**
 * Throwaway pages for the school-plane specs, made by the district admin through the REST API
 * and deleted after. A seeded page would carry review state and titles from one run into the
 * next, and every school has the same seeded titles.
 */

/**
 * A Text section holding one paragraph — how a page holds its words now (Jason, 2026-11-04), so a
 * fixture page's form opens on an editor the way a real page's does.
 */
export const wordsSection = (text: string) => ({
  blockType: 'richText',
  content: {
    root: {
      type: 'root',
      direction: null,
      format: '',
      indent: 0,
      version: 1,
      children: [{ type: 'paragraph', version: 1, children: [{ type: 'text', text, version: 1 }] }],
    },
  },
})

export type FixturePage = { id: number; slug: string; title: string; admin: APIRequestContext }

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

export const makePage = async (
  baseURL: string | undefined,
  {
    title = 'Field trip forms',
    hostname = SCHOOL_HOSTNAME,
    /** `null` leaves it out, so the slug hook derives it from the title as a real create does. */
    slug = `e2e-${unique()}` as string | null,
  } = {},
): Promise<FixturePage> => {
  const admin = await playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: ADMIN_STORAGE_STATE,
  })
  const tenant = await tenantIdFor(admin, hostname)
  const res = await admin.post('/api/pages?draft=true&depth=0', {
    data: {
      title,
      ...(slug === null ? {} : { slug }),
      tenant,
      // Every page is composed (Jason, 2026-11-04): its words are a Text section.
      pageType: 'composed',
      layout: [wordsSection('Forms are due Friday.')],
      _status: 'draft',
    },
  })
  expect(res.ok(), `create fixture page: ${res.status()} ${await res.text()}`).toBe(true)
  const doc = (await res.json()).doc as { id: number; slug: string }
  return { id: doc.id, slug: doc.slug, title, admin }
}

/**
 * Delete a page a browser had open. Payload locks a document while its edit form is open and
 * refuses the delete (423) until the lock goes — and the lock outlives the test's page. A
 * leftover published page then shows up in another spec's sitemap count, so release it first.
 */
export const deletePage = async (admin: APIRequestContext, id: number) => {
  await admin.delete(
    `/api/payload-locked-documents?where[document.relationTo][equals]=pages&where[document.value][equals]=${id}`,
  )
  const res = await admin.delete(`/api/pages/${id}`)
  expect(res.ok(), `delete fixture page ${id}: ${res.status()} ${await res.text()}`).toBe(true)
}

export const dropPage = async ({ id, admin }: FixturePage) => {
  await deletePage(admin, id)
  await admin.dispose()
}

/** A title no other page has, for specs that look a page up by its title. */
export const uniqueTitle = (base: string) => `${base} ${unique()}`

/** The edit form of a page, once its title field is usable. */
export const openPage = async (page: Page, id: number | string) => {
  await page.goto(`/admin/collections/pages/${id}`)
  await expect(page.locator('#field-title')).toBeEditable({ timeout: 20_000 })
}

const BLOCKING_IMPACTS = ['critical', 'serious']

/** Zero critical/serious axe violations inside `selector` (CLAUDE.md rule 6). */
export const expectNoBlockingViolations = async (page: Page, selector: string) => {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(
    blocking,
    `Blocking a11y violations in ${selector}:\n${blocking
      .map(
        (v) =>
          `  [${v.impact}] ${v.id}: ${v.help}\n` +
          v.nodes
            .map((n) => `      ${n.html.slice(0, 160)}\n      ${n.any[0]?.message ?? ''}`)
            .join('\n'),
      )
      .join('\n')}`,
  ).toEqual([])
}

/** An API context signed in as the School A manager — for writes the district cannot make. */
export const schoolRequest = (baseURL: string | undefined) =>
  playwrightRequest.newContext({
    ...(baseURL ? { baseURL } : {}),
    storageState: SCHOOL_STORAGE_STATE,
  })

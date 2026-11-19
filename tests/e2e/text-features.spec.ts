import AxeBuilder from '@axe-core/playwright'
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test'

import { ADMIN_STORAGE_STATE, adminCredentials, adminTest } from './support/admin-session'
import { dropPage, makePage, openPage, uniqueTitle } from './support/fixture-pages'
import { SCHOOL_HOSTNAME, tenantIdFor } from './support/school-session'
import { siteUrl } from './support/site-url'

/**
 * The Text editor's added features (Jason, 2026-11-19, "a more robust text editor"): aligned
 * text, a quotation, a line, and an image from the site's library — on the public page, with no
 * blocking axe violation; and the toolbar's buttons, named in words, inserting into the page.
 *
 * Built, then locked here (CLAUDE.md: the editor's toolbar is admin React). The mapping and the
 * fill are unit- and integration-tested (`rich-text.test.ts`, `rich-text-images.test.ts`).
 */

const credentials = adminCredentials()
const SKIP =
  'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.'

/** A real 2×2 PNG — Payload checks what it is given. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNkYGD4z8DAwMDAwMAAAAgPAQBJpJ4YAAAAAElFTkSuQmCC',
  'base64',
)

const blocking = async (page: Page) =>
  (
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  ).violations
    .filter((v) => ['critical', 'serious'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)

/**
 * The HTML view's code box is Monaco (Payload's code editor): its input is a hidden textarea that
 * holds only part of the code, so the code is read and set through Monaco's own API.
 */
type MonacoWindow = {
  monaco: {
    editor: { getEditors: () => { getValue: () => string; setValue: (v: string) => void }[] }
  }
}
const codeOf = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as MonacoWindow).monaco.editor.getEditors().at(-1)?.getValue(),
  )
const setCode = (page: Page, value: string) =>
  page.evaluate(
    (v) => (window as unknown as MonacoWindow).monaco.editor.getEditors().at(-1)!.setValue(v),
    value,
  )

const words = (text: string, format = '') => ({
  type: 'paragraph',
  version: 1,
  format,
  children: [{ type: 'text', version: 1, text }],
})

test.describe('the added text features on the public page', () => {
  test.skip(credentials === null, SKIP)

  test('@a11y centered text, a quotation, a line and a library image', async ({
    page,
    baseURL,
  }) => {
    const admin = await playwrightRequest.newContext({
      ...(baseURL ? { baseURL } : {}),
      storageState: ADMIN_STORAGE_STATE,
    })
    const tenant = await tenantIdFor(admin, SCHOOL_HOSTNAME)
    const uploaded = await admin.post('/api/resources?depth=0', {
      multipart: {
        file: { name: `text-${Date.now()}.png`, mimeType: 'image/png', buffer: PNG },
        _payload: JSON.stringify({ tenant, title: 'Playground', alt: 'The new playground' }),
      },
    })
    expect(uploaded.ok(), await uploaded.text()).toBe(true)
    const file = ((await uploaded.json()) as { doc: { id: number } }).doc.id
    const slug = `text-features-${Date.now()}`
    const made = await admin.post('/api/pages?depth=0', {
      data: {
        tenant,
        title: uniqueTitle('Welcome back'),
        slug,
        visibility: 'public',
        _status: 'published',
        layout: [
          {
            blockType: 'richText',
            content: {
              root: {
                type: 'root',
                version: 1,
                children: [
                  words('The first day is Monday.', 'center'),
                  {
                    type: 'quote',
                    version: 1,
                    children: [{ type: 'text', version: 1, text: 'Every student, every day.' }],
                  },
                  { type: 'horizontalrule', version: 1 },
                  { type: 'upload', version: 3, relationTo: 'resources', value: file, fields: {} },
                  words('— The principal', 'right'),
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [
                      {
                        type: 'link',
                        version: 3,
                        fields: {
                          linkType: 'custom',
                          url: 'https://example.org/bond',
                          newTab: false,
                          ariaLabel: 'Read more about the bond election',
                        },
                        children: [{ type: 'text', version: 1, text: 'Read more' }],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
    })
    expect(made.ok(), await made.text()).toBe(true)
    const id = ((await made.json()) as { doc: { id: number } }).doc.id
    try {
      await expect(async () => {
        await page.goto(siteUrl(baseURL, SCHOOL_HOSTNAME, `/${slug}`))
        await expect(page.getByText('The first day is Monday.')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByText('The first day is Monday.')).toHaveCSS('text-align', 'center')
      // Right is END: it mirrors in a right-to-left translation.
      await expect(page.getByText('— The principal')).toHaveCSS('text-align', 'end')
      await expect(page.locator('blockquote')).toHaveText('Every student, every day.')
      await expect(page.locator('main hr')).toHaveCount(1)
      await expect(page.getByRole('img', { name: 'The new playground' })).toBeVisible()
      // A link's own screen-reader words, which contain its visible words (WCAG 2.5.3).
      await expect(
        page.getByRole('link', { name: 'Read more about the bond election' }),
      ).toHaveText('Read more')
      expect(await blocking(page)).toEqual([])
    } finally {
      await admin.delete(`/api/pages/${id}`)
      await admin.delete(`/api/resources/${file}`)
      await admin.dispose()
    }
  })
})

adminTest.describe('the editor’s toolbar', () => {
  adminTest.skip(credentials === null, SKIP)

  adminTest(
    '@a11y its buttons are in sight and named; "Insert a line" adds one to the page',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        await page.locator('.ContentEditable__root').first().click()
        const toolbar = page.locator('.fixed-toolbar').first()
        for (const name of [
          'Insert an image',
          'Insert a line',
          'HTML code',
          'Normal text',
          'Heading',
          'Subheading',
          'Bulleted list',
          'Numbered list',
          'Quotation',
          'Align text',
          'Bold',
          'Italic',
        ])
          await expect(toolbar.getByRole('button', { name, exact: true })).toBeVisible()

        await toolbar.getByRole('button', { name: 'Insert a line', exact: true }).click()
        await expect
          .poll(
            async () =>
              JSON.stringify(
                await (
                  await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
                ).json(),
              ).includes('"horizontalrule"'),
            { timeout: 20_000 },
          )
          .toBe(true)
        expect(await blocking(page)).toEqual([])
      } finally {
        await dropPage(fixture)
      }
    },
  )

  adminTest(
    '@a11y "HTML code" shows the text as HTML, names what a change took out, and updates the rest',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      // Monaco is BUNDLED: nothing comes from a CDN (Payload's loader would use jsDelivr).
      const cdn: string[] = []
      page.on('request', (request) => {
        if (/jsdelivr|unpkg|cdnjs/.test(request.url())) cdn.push(request.url())
      })
      try {
        await openPage(page, fixture.id)
        await page.locator('.ContentEditable__root').first().click()
        const toolbar = page.locator('.fixed-toolbar').first()
        // After the everyday "add" buttons.
        const keys = await toolbar
          .locator('button[data-button-key]')
          .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('data-button-key')))
        expect(keys.indexOf('htmlSource')).toBeGreaterThan(keys.indexOf('horizontalRule'))
        await toolbar.getByRole('button', { name: 'HTML code', exact: true }).click()

        const dialog = page.getByRole('dialog', { name: 'HTML code' })
        const code = dialog.getByRole('textbox', { name: 'The text as HTML' })
        await expect(dialog.locator('.monaco-editor')).toBeVisible()
        await expect.poll(() => codeOf(page)).toBe('<p>Forms are due Friday.</p>')
        await expect(code).toBeFocused()
        // No keyboard trap (WCAG 2.1.2): Tab leaves the code box, as from any field.
        await page.keyboard.press('Tab')
        await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
        await page.keyboard.press('Shift+Tab')
        await expect(code).toBeFocused()
        // It PAINTS: the design tokens are loaded in the admin, so the box is opaque, not a
        // see-through panel over the backdrop (2026-11-19 — Storybook loads them, the admin did not).
        await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)')
        expect(await blocking(page)).toEqual([])

        await setCode(
          page,
          '<p>Forms are due Friday.</p>\n' +
            '<blockquote>Every student, every day.</blockquote>\n' +
            '<iframe src="https://forms.office.com/x">Loading</iframe>\n' +
            '<p style="color:red" onclick="track()">Sign up today.</p>',
        )
        await dialog.getByRole('button', { name: 'Update the text' }).click()

        const report = page.getByRole('dialog', { name: 'Before the text changes' })
        await expect(report).toContainText('We removed embedded content')
        await expect(report).toContainText('We removed code that runs in the browser')
        await expect(report).toContainText('We removed styling')
        expect(await blocking(page)).toEqual([])

        await report.getByRole('button', { name: 'Update with the rest' }).click()
        await expect(report).toBeHidden()
        const editor = page.locator('.ContentEditable__root').first()
        await expect(editor.locator('blockquote')).toHaveText('Every student, every day.')
        await expect(editor.locator('p').first()).toHaveText('Forms are due Friday.')
        await expect(editor.locator('p').last()).toHaveText('Sign up today.')

        await expect
          .poll(
            async () => {
              const doc = JSON.stringify(
                await (
                  await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)
                ).json(),
              )
              return doc.includes('"quote"') && doc.includes('Sign up today.')
            },
            { timeout: 20_000 },
          )
          .toBe(true)
        const saved = JSON.stringify(
          await (await fixture.admin.get(`/api/pages/${fixture.id}?draft=true&depth=0`)).json(),
        )
        expect(saved).not.toMatch(/iframe|onclick|color:red|Loading/)
        expect(cdn).toEqual([])

        // Opened again, it shows the text as it is now.
        await toolbar.getByRole('button', { name: 'HTML code', exact: true }).click()
        await expect(dialog.locator('.monaco-editor')).toBeVisible()
        await expect
          .poll(() => codeOf(page))
          .toBe(
            '<p>Forms are due Friday.</p>\n<blockquote>Every student, every day.</blockquote>\n<p>Sign up today.</p>',
          )
      } finally {
        await dropPage(fixture)
      }
    },
  )

  adminTest(
    '"HTML code": a clean change updates at once; Cancel leaves the text alone',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        const editor = page.locator('.ContentEditable__root').first()
        await editor.click()
        const open = () =>
          page
            .locator('.fixed-toolbar')
            .first()
            .getByRole('button', { name: 'HTML code', exact: true })
            .click()
        const dialog = page.getByRole('dialog', { name: 'HTML code' })
        const code = dialog.getByRole('textbox', { name: 'The text as HTML' })

        await open()
        await expect(code).toBeFocused()
        // Typed, as an author would: select all, then the new code.
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.insertText(
          '<h2>Field trip</h2>\n<p style="text-align: center">Forms are due Friday.</p>',
        )
        await dialog.getByRole('button', { name: 'Update the text' }).click()
        await expect(dialog).toBeHidden()
        await expect(editor.locator('h2')).toHaveText('Field trip')

        await open()
        await expect(dialog.locator('.monaco-editor')).toBeVisible()
        await setCode(page, '<p>Gone</p>')
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        await expect(dialog).toBeHidden()
        await expect(editor.locator('h2')).toHaveText('Field trip')
        await expect(editor).not.toContainText('Gone')
      } finally {
        await dropPage(fixture)
      }
    },
  )

  adminTest(
    '"HTML code" with nothing it can keep offers only the way back',
    async ({ page, baseURL }) => {
      const fixture = await makePage(baseURL)
      try {
        await openPage(page, fixture.id)
        await page.locator('.ContentEditable__root').first().click()
        await page
          .locator('.fixed-toolbar')
          .first()
          .getByRole('button', { name: 'HTML code', exact: true })
          .click()
        const dialog = page.getByRole('dialog', { name: 'HTML code' })
        await expect(dialog.locator('.monaco-editor')).toBeVisible()
        await setCode(page, '<iframe src="https://maps.google.com/x"></iframe>')
        await dialog.getByRole('button', { name: 'Update the text' }).click()

        const report = page.getByRole('dialog', { name: 'Nothing in this code can go in the text' })
        await expect(report.getByRole('button', { name: 'Update with the rest' })).toHaveCount(0)
        await report.getByRole('button', { name: 'Back to the code' }).click()
        await expect
          .poll(() => codeOf(page))
          .toBe('<iframe src="https://maps.google.com/x"></iframe>')
      } finally {
        await dropPage(fixture)
      }
    },
  )
})

import { readFileSync } from 'node:fs'

import AxeBuilder from '@axe-core/playwright'
import { expect, type Locator, type Page } from '@playwright/test'

import { assignTenant } from './support/admin-form'
import { adminCredentials, adminTest as test } from './support/admin-session'

/**
 * The paste normalizer, driven through the real editor (`07` §4.2).
 *
 * WHY THIS SPEC EXISTS RATHER THAN A UNIT SUITE. The transform is already covered by
 * `tests/unit/paste-normalizer.test.ts` against the same fixtures used here, and that is the
 * highest-value unit suite in the project. What it cannot cover is the half added in this PR:
 * a browser paste event, a Lexical command, and a dialog. CLAUDE.md's TDD exception table
 * puts custom admin React on the build-then-lock path, and names this — a Playwright flow
 * plus an axe assertion, in the same PR — as the required lock.
 *
 * THE FIXTURE IS THE UNIT SUITE'S FIXTURE. `word-agenda.html` is a real Word payload with a
 * layout table, a logo and four bold lines standing in for headings, so one paste exercises
 * both halves of the prompt. Sharing it means the unit suite and this spec cannot disagree
 * about what a real paste contains.
 */

const credentials = adminCredentials()

const WORD_AGENDA = readFileSync('tests/fixtures/paste/word-agenda.html', 'utf8')

/** The four bold lines in the fixture, in document order. */
const AGENDA_HEADINGS = ['PTO Meeting Agenda', 'Standing Items', 'New Business', 'Meeting Dates']

const BLOCKING_IMPACTS = ['critical', 'serious']

/**
 * The paste prompt, addressed by its accessible name.
 *
 * Named rather than taken as "the dialog on the page", because there are two: the multi-tenant
 * plugin's tenant-assignment modal is also a `<dialog>`. Matching on the name also asserts the
 * prompt HAS one, which is the requirement a nameless modal fails.
 */
const pastePrompt = (page: Page): Locator => page.getByRole('dialog', { name: /pasted/i })

/**
 * A new page opens with no sections (every page composed, Jason 2026-11-04): add a Text section,
 * as an editor would, through the section picker.
 */
const addTextSection = async (page: Page) => {
  const add = page.locator('#field-layout').getByRole('button', { name: /^Add / }).last()
  await expect(add).toBeVisible({ timeout: 20_000 })
  await add.click()
  await page
    .getByRole('dialog')
    .last()
    .getByRole('button', { name: /^Text$/ })
    .first()
    .click()
}

/**
 * The Text section's editor.
 *
 * Asserted to be the only one on the page rather than taken with `.first()`: if a second
 * rich-text field is added later, this should fail and be pointed at the right one, not
 * silently start testing whichever renders first.
 */
const bodyEditor = async (page: Page): Promise<Locator> => {
  const editors = page.locator('[contenteditable="true"]')

  // Generous: the admin create screen is a heavy first render, and several workers hit one
  // `next start` at once. The default 5s was not a real budget for it.
  await expect(editors).toHaveCount(1, { timeout: 20_000 })
  return editors
}

/**
 * Paste into the focused editor.
 *
 * A synthetic `ClipboardEvent` carrying a real `DataTransfer`, because Playwright cannot put
 * `text/html` on the OS clipboard. This is the same event Lexical would receive from a real
 * paste — it reaches `PASTE_COMMAND` through the editor's own listener — so what is under
 * test is the handler, not the dispatch.
 */
const pasteInto = async (editor: Locator, html: string, text = '') => {
  await editor.click()
  await editor.evaluate(
    (element, payload) => {
      const data = new DataTransfer()
      if (payload.html) data.setData('text/html', payload.html)
      if (payload.text) data.setData('text/plain', payload.text)

      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
      )
    },
    { html, text },
  )
}

test.describe('pasting into the rich text editor', () => {
  test.skip(
    credentials === null,
    'No SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD — set them in .env and re-run `pnpm run seed`.',
  )

  // The session arrives with the fixture, so this is the navigation and the one step the
  // plugin puts in front of the form.
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/collections/pages/create')
    await assignTenant(page, 'DD2 District')
    await addTextSection(page)
  })

  test('@smoke a Word agenda opens one prompt naming what was removed', async ({ page }) => {
    const editor = await bodyEditor(page)
    await pasteInto(editor, WORD_AGENDA)

    const prompt = pastePrompt(page)
    await expect(prompt).toBeVisible()

    // The plain-language rejections from `07` §4.2 rows 6-7, in the author's words.
    await expect(prompt).toContainText('We removed a table.')
    await expect(prompt).toContainText('We removed an image.')

    // Fixed wording — `07` §4.2 does not leave this to paraphrase.
    await expect(prompt).toContainText('These lines look like headings. Mark them as headings?')

    // Every candidate is listed, so a yes is an informed one.
    for (const heading of AGENDA_HEADINGS) await expect(prompt).toContainText(heading)
  })

  test('@smoke @a11y the prompt has zero critical or serious axe violations', async ({ page }) => {
    const editor = await bodyEditor(page)
    await pasteInto(editor, WORD_AGENDA)
    await expect(pastePrompt(page)).toBeVisible()

    /**
     * SCOPED TO THE DIALOG, deliberately. Non-negotiable rule 6 covers both admin planes, but
     * `07` §2 brings Payload's own admin chrome into the gate in Phase 4 — scanning the whole
     * page now would gate this PR on markup it did not write and cannot fix here. The dialog
     * is what this PR adds, so the dialog is what it must answer for.
     *
     * `tests/a11y/storybook.spec.ts` covers the same component in both writing directions.
     */
    const results = await new AxeBuilder({ page })
      .include('dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))

    expect(
      blocking,
      `Blocking a11y violations in the paste prompt:\n${blocking
        .map((v) => `  [${v.impact}] ${v.id}: ${v.help}`)
        .join('\n')}`,
    ).toEqual([])
  })

  test('@smoke saying yes turns the bold lines into real headings', async ({ page }) => {
    const editor = await bodyEditor(page)
    await pasteInto(editor, WORD_AGENDA)

    await page.getByRole('button', { name: 'Yes' }).click()
    await expect(pastePrompt(page)).toBeHidden()

    for (const heading of AGENDA_HEADINGS) {
      await expect(editor.locator('h2').filter({ hasText: heading })).toHaveCount(1)
    }

    /**
     * The lists survive as lists. This is the transform `07` §4.2 calls the highest-value one
     * — the fixture's bullets are literal characters and manual breaks in Word, and a list
     * that arrives as loose paragraphs carries no structure at all.
     */
    await expect(editor.locator('ul li')).toHaveCount(3)
    await expect(editor.locator('ol li')).toHaveCount(3)

    // Nothing rejected made it in.
    await expect(editor.locator('table')).toHaveCount(0)
    await expect(editor.locator('img')).toHaveCount(0)
  })

  test('@smoke saying no keeps the text but still pastes it', async ({ page }) => {
    const editor = await bodyEditor(page)
    await pasteInto(editor, WORD_AGENDA)

    await page.getByRole('button', { name: 'No, keep as text' }).click()
    await expect(pastePrompt(page)).toBeHidden()

    await expect(editor.locator('h2')).toHaveCount(0)
    await expect(editor).toContainText('PTO Meeting Agenda')
    await expect(editor.locator('ul li')).toHaveCount(3)
  })

  test('@smoke dismissing the prompt does not lose the paste', async ({ page }) => {
    /**
     * The one that matters most for the usability bar. An author who presses Escape means
     * "stop asking me", not "throw away the agenda I just pasted" — and nothing is inserted
     * until the prompt resolves, so a dismissal that did nothing would silently discard the
     * whole paste.
     */
    const editor = await bodyEditor(page)
    await pasteInto(editor, WORD_AGENDA)
    await expect(pastePrompt(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(pastePrompt(page)).toBeHidden()

    await expect(editor).toContainText('PTO Meeting Agenda')
    await expect(editor.locator('h2')).toHaveCount(0)
  })

  test('@smoke a clean paste is not interrupted', async ({ page }) => {
    // Nothing removed and no bold lines to ask about: the common case must cost no dialog.
    const editor = await bodyEditor(page)
    await pasteInto(editor, '<p>Report cards go home on Friday.</p>')

    await expect(editor).toContainText('Report cards go home on Friday.')
    await expect(pastePrompt(page)).toBeHidden()
  })

  test('@smoke a plain text paste is left to the editor', async ({ page }) => {
    /**
     * No HTML flavour means no markup to strip and no structure to mistake for one, so the
     * handler stands down and Lexical's own paste path runs. Asserted because the alternative
     * — intercepting everything — would route ordinary typing-adjacent pastes through a
     * normalizer that has nothing to do.
     */
    const editor = await bodyEditor(page)
    await pasteInto(editor, '', 'Bus route 12 is running late.')

    await expect(editor).toContainText('Bus route 12 is running late.')
    await expect(pastePrompt(page)).toBeHidden()
  })
})

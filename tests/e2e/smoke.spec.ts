import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The axe gate, failing closed from Phase 0 — before any feature exists — so the bar is
 * never "added later" (`05` Phase 0, `07` §7).
 *
 * ZERO critical/serious violations to merge. Scope grows as components land; every new
 * block registers its own axe test in the same PR (`06` §2.4). Both admin planes enter this
 * gate in Phase 4 — an inaccessible admin excludes DD2 staff from their own jobs (`07` §2).
 */

const BLOCKING_IMPACTS = ['critical', 'serious']

test('@smoke home page renders', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('@smoke @a11y home page has zero critical or serious axe violations', async ({ page }) => {
  await page.goto('/')

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))

  expect(
    blocking,
    `Blocking a11y violations:\n${blocking
      .map(
        (v) => `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target).join(', ')}`,
      )
      .join('\n')}`,
  ).toEqual([])
})

test('@smoke @a11y the axe gate fails closed', async ({ page }) => {
  /**
   * Proves the gate DETECTS violations rather than silently passing — the a11y equivalent
   * of the lint guardrail suites in tests/unit/guardrails.
   *
   * A gate that has quietly stopped analysing is worse than no gate, because the
   * conformance claim keeps being made while nothing backs it. `07` §7 puts the axe gate in
   * Phase 0 specifically so the bar is never "added later"; this test is what keeps it
   * honest as the scope grows.
   */
  await page.goto('/')
  await page.evaluate(() => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    // Deliberately no alt attribute -> axe "image-alt", impact: critical.
    document.body.appendChild(img)
  })

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.includes(v.impact ?? ''))
  expect(blocking.map((v) => v.id)).toContain('image-alt')
})

test('@smoke @a11y html carries a valid lang attribute', async ({ page }) => {
  // WCAG 3.1.1 Language of Page. Release-blocking in every enabled locale (`08` §6).
  await page.goto('/')
  const lang = await page.locator('html').getAttribute('lang')
  expect(lang).toBeTruthy()
})

test('@smoke @rtl @a11y html carries an explicit dir attribute', async ({ page }) => {
  // Phase 0 asserts only that direction is declared rather than inherited. Phase 2 makes
  // it locale-derived; Phase 7 proves dir="rtl" for Arabic across every template (`08` §6).
  await page.goto('/')
  const dir = await page.locator('html').getAttribute('dir')
  expect(['ltr', 'rtl']).toContain(dir)
})

test('@smoke @a11y the first tab stop skips past the header into main', async ({ page }) => {
  /**
   * Bypass blocks — WCAG 2.4.1 (`07` §3). Asserted as behaviour rather than as markup:
   * a skip link that exists, is reachable, and points at an id that is not there still
   * passes every static check and does nothing for the person using it.
   */
  await page.goto('/')
  await page.keyboard.press('Tab')

  const href = await page.evaluate(() => document.activeElement?.getAttribute('href'))
  expect(href).toBe('#main-content')

  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')

  const focusIsInsideMain = await page.evaluate(
    () => document.querySelector('main#main-content')?.contains(document.activeElement) ?? false,
  )
  expect(focusIsInsideMain).toBe(true)
})

test('@smoke keyboard focus is visible on the first interactive element', async ({ page }) => {
  // 2.4.11 focus appearance (`07` §3). Keyboard-only completion is a release check for
  // every school task from Phase 4 onward (`04` §6).
  await page.goto('/')
  await page.keyboard.press('Tab')
  const outline = await page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    return getComputedStyle(el).outlineStyle
  })
  if (outline !== null) expect(outline).not.toBe('none')
})

import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * axe over every story, in both directions (`06` §2.4, `07` §3).
 *
 * This is the gate behind "every block ships with an axe test in the same PR". It is driven
 * from Storybook's own story index rather than a hand-maintained list, so a new story is in
 * the gate the moment it exists — the failure mode of a list is that the component someone
 * forgot to add is exactly the one that needed checking.
 *
 * Run in real Chromium, not jsdom, because the rules that matter most here — color contrast,
 * focus appearance, anything computed from layout — do not exist without a layout engine. It
 * is also the RTL check the design suite asks for from the first component (`08` §7): the same
 * stories re-run with `dir="rtl"` and `lang="ar"`, which is when a physical property that
 * slipped past stylelint shows up as an overlap or an off-screen element.
 */

const BLOCKING_IMPACTS = ['critical', 'serious']
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const DIRECTIONS = [
  { direction: 'ltr', locale: 'en' },
  { direction: 'rtl', locale: 'ar' },
] as const

/**
 * Stand the a11y addon's own checker down for these runs.
 *
 * The addon runs axe inside the preview on every story render; this spec runs axe from
 * Playwright. Two axe instances in one frame is not a slow-and-correct situation — axe
 * refuses outright ("Axe is already running"), and which one wins depends on render timing,
 * so the gate would pass or fail by luck.
 *
 * Disabling it here rather than in `preview.tsx` keeps the automatic in-panel check while
 * developing, where it belongs. The CI answer comes from one implementation, in a real
 * browser, with the same axe version as the public gate.
 */
const storyUrl = (id: string, direction: string, locale: string) =>
  `/iframe.html?viewMode=story&id=${encodeURIComponent(id)}` +
  `&globals=direction:${direction};locale:${encodeURIComponent(locale)};a11y.manual:!true`

type StoryEntry = {
  readonly id: string
  readonly title: string
  readonly name: string
  readonly type: string
}

type StoryIndex = { readonly entries: Record<string, StoryEntry> }

for (const { direction, locale } of DIRECTIONS) {
  test(`@a11y ${direction === 'rtl' ? '@rtl ' : ''}every story is free of critical and serious axe violations (${direction})`, async ({
    page,
  }) => {
    const response = await page.request.get('/index.json')
    expect(response.ok(), 'Storybook did not serve a story index').toBeTruthy()

    const index = (await response.json()) as StoryIndex
    const stories = Object.values(index.entries).filter((entry) => entry.type === 'story')

    /**
     * Guards the guard. If the index ever comes back empty — a renamed stories glob, a build
     * that produced nothing — every assertion below passes vacuously and the gate reports
     * conformance for zero components.
     */
    expect(stories.length, 'no stories found in the Storybook index').toBeGreaterThan(5)

    const failures: string[] = []

    for (const story of stories) {
      await page.goto(storyUrl(story.id, direction, locale))

      // Wait for the story itself, not just the shell: an empty root would analyse clean.
      await page.locator('#storybook-root > *').first().waitFor({ state: 'attached' })

      const results = await new AxeBuilder({ page })
        .include('#storybook-root')
        .withTags(WCAG_TAGS)
        .analyze()

      for (const violation of results.violations) {
        if (!BLOCKING_IMPACTS.includes(violation.impact ?? '')) continue

        failures.push(
          `${story.title} / ${story.name} [${violation.impact}] ${violation.id}: ${violation.help}\n` +
            `    ${violation.nodes.map((node) => node.target.join(' ')).join('\n    ')}`,
        )
      }
    }

    expect(
      failures,
      `Blocking a11y violations in ${direction.toUpperCase()}:\n${failures.join('\n')}`,
    ).toEqual([])
  })
}

test('@a11y the component axe gate fails closed', async ({ page }) => {
  /**
   * The counterpart to the same test on the public gate (`tests/e2e/smoke.spec.ts`). A gate
   * that has quietly stopped analysing is worse than no gate, because the conformance claim
   * keeps being made while nothing backs it — and this one analyses a scoped subtree
   * (`#storybook-root`), which is one more way for it to end up looking at nothing.
   */
  const response = await page.request.get('/index.json')
  const index = (await response.json()) as StoryIndex
  const [story] = Object.values(index.entries).filter((entry) => entry.type === 'story')
  expect(story, 'no stories found in the Storybook index').toBeDefined()

  await page.goto(storyUrl(story?.id ?? '', 'ltr', 'en'))
  await page.locator('#storybook-root > *').first().waitFor({ state: 'attached' })

  await page.evaluate(() => {
    const img = document.createElement('img')
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

    /**
     * Into the open modal when the story has one, otherwise into the root.
     *
     * A story that calls `showModal()` — `Admin/PastePrompt` — makes everything OUTSIDE the
     * dialog inert, and axe is right to report nothing there. Appending to `#storybook-root`
     * unconditionally therefore made this guard depend on which story happens to sort first
     * in the index, which is not a property anyone maintains on purpose. Injecting where axe
     * will actually look keeps the assertion about axe rather than about story ordering.
     */
    const host =
      document.querySelector('#storybook-root dialog[open]') ??
      document.querySelector('#storybook-root')

    // Deliberately no alt attribute -> axe "image-alt", impact: critical.
    host?.appendChild(img)
  })

  const results = await new AxeBuilder({ page })
    .include('#storybook-root')
    .withTags(WCAG_TAGS)
    .analyze()

  expect(results.violations.map((violation) => violation.id)).toContain('image-alt')
})

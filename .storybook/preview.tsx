import type { Decorator, Preview } from '@storybook/nextjs-vite'

import '../src/styles/globals.css'

/**
 * Every story renders under a `lang` and `dir` chosen from the toolbar, defaulting to
 * `en`/`ltr`.
 *
 * Both attributes go on `<html>`, not on a wrapper: that is where the public layout puts them
 * (`08` §6), and it is the only place the `:root:lang()` typography tokens in `tokens.css`
 * will match. A wrapper `dir` would mirror the layout but leave CJK line-height and the
 * Arabic font stack untested, which is the half most likely to be wrong.
 *
 * `tests/a11y/storybook.spec.ts` drives these globals over the URL, which is how one story
 * set produces both the LTR and the RTL axe run.
 */

const DIRECTIONS = ['ltr', 'rtl'] as const

const withDocumentLanguage: Decorator = (Story, context) => {
  const direction = String(context.globals['direction'] ?? 'ltr')
  const locale = String(context.globals['locale'] ?? 'en')

  document.documentElement.dir = DIRECTIONS.includes(direction as (typeof DIRECTIONS)[number])
    ? direction
    : 'ltr'
  document.documentElement.lang = locale

  return <Story />
}

const preview: Preview = {
  decorators: [withDocumentLanguage],

  initialGlobals: { direction: 'ltr', locale: 'en' },

  globalTypes: {
    direction: {
      description: 'Text direction on <html>',
      toolbar: {
        title: 'Direction',
        icon: 'transfer',
        items: [
          { value: 'ltr', title: 'LTR' },
          { value: 'rtl', title: 'RTL' },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: 'Locale on <html> — drives the per-locale typography tokens (`08` §7)',
      toolbar: {
        title: 'Locale',
        icon: 'globe',
        items: [
          { value: 'en', title: 'English' },
          { value: 'es', title: 'Español' },
          { value: 'zh-Hans', title: '简体中文' },
          { value: 'ko', title: '한국어' },
          { value: 'pt', title: 'Português' },
          { value: 'ar', title: 'العربية' },
        ],
        dynamicTitle: true,
      },
    },
  },

  parameters: {
    // Violations fail the story in the addon panel as well as in CI, so a component is not
    // "done" in development either until it is clean (`07` §7).
    a11y: { test: 'error' },
    layout: 'padded',
  },
}

export default preview

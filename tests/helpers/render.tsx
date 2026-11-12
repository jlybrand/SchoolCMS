import { cleanup, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach } from 'vitest'

/**
 * Render helper for component unit tests.
 *
 * Scope, deliberately narrow: these tests assert *semantics* — the element a component
 * produces, its role, its accessible name, its heading level. They do not assert layout,
 * because jsdom has none.
 *
 * That is why axe does not run here. Component accessibility is checked by
 * `tests/a11y/storybook.spec.ts`, which runs axe over every story in real Chromium in both
 * directions, where color contrast, focus appearance and RTL mirroring actually exist. Two
 * axe implementations reporting different results on the same component would be worse than
 * one that is trusted (`06` §2.4).
 */

afterEach(cleanup)

export type RenderOptions = {
  /** Mirrors what the public layout puts on `<html>` (`08` §6). */
  readonly dir?: 'ltr' | 'rtl'
  readonly lang?: string
}

export const renderComponent = (ui: ReactElement, options: RenderOptions = {}): RenderResult => {
  const { dir = 'ltr', lang = 'en' } = options

  // Set on the document rather than a wrapper so `:root:lang()` token overrides and
  // inherited direction behave as they do in the app.
  document.documentElement.lang = lang
  document.documentElement.dir = dir

  return render(ui)
}

import type { StorybookConfig } from '@storybook/nextjs-vite'

/**
 * Storybook is the component-in-isolation surface required by `03` §3, `05` Phase 3 and
 * `07` §3: every block ships with a story and an axe test in the same PR.
 *
 * It serves two audiences. For development it is where a component's states get looked at —
 * which is the only honest way to build layout and typography (`06`: test-first is the wrong
 * tool there). For CI it is the fixture set that `tests/a11y/storybook.spec.ts` runs axe over
 * in both directions, so a component cannot regress in isolation even before a page uses it.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/nextjs-vite', options: {} },

  // Colocated with the components they document, so a component and its story move together.
  stories: ['../src/**/*.stories.@(ts|tsx)'],

  addons: ['@storybook/addon-a11y'],

  // Nothing to serve statically yet. Media lands on R2 in Phase 6 (`02` §2).
  staticDirs: [],
}

export default config

import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { LanguageSwitcher } from './LanguageSwitcher'

const meta = {
  title: 'Site/LanguageSwitcher',
  component: LanguageSwitcher,
  args: { locales: ['en', 'es'], locale: 'en', currentPath: '/about' },
} satisfies Meta<typeof LanguageSwitcher>

export default meta

type Story = StoryObj<typeof meta>

/** English and Spanish — the common case. "English" is current. */
export const Default: Story = {}

/**
 * Every platform language, read in Arabic — four scripts on one row, each link with its own
 * `lang`. Narrow the preview to 320px and it wraps without losing one.
 */
export const EveryLanguage: Story = {
  args: { locales: ['en', 'es', 'zh-Hans', 'ko', 'pt', 'ar'], locale: 'ar' },
}

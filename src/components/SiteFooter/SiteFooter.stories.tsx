import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { MenuLink } from '@/content/types'

import { SiteFooter } from './SiteFooter'

const link = (label: string, href: string, newTab = false): MenuLink => ({
  id: label,
  label,
  href,
  newTab,
})

const meta = {
  title: 'Site/SiteFooter',
  component: SiteFooter,
  args: {
    siteName: 'Summerville Middle School',
    links: [
      link('Contact', '/contact'),
      link('Accessibility', '/accessibility'),
      link('Call the office', 'tel:+18435550100'),
      link('District site', 'https://www.example.org', true),
    ],
    currentPath: '/contact',
    locale: 'en',
  },
} satisfies Meta<typeof SiteFooter>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** No footer links yet: the landmark and the name, and no empty `<nav>`. */
export const NoLinks: Story = { args: { links: [] } }

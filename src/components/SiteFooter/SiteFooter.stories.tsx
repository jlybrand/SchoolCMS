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
    contact: {
      address: ['123 Main Street', 'Summerville, SC 29483'],
      phone: { text: '(843) 555-0100', href: 'tel:8435550100' },
      email: { text: 'office@example.org', href: 'mailto:office@example.org' },
    },
    social: [
      { id: 'fb', platform: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/' },
      { id: 'yt', platform: 'youtube', label: 'YouTube', href: 'https://www.youtube.com/' },
    ],
    currentPath: '/contact',
    locale: 'en',
  },
} satisfies Meta<typeof SiteFooter>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** No footer links yet: no empty `<nav>`. */
export const NoLinks: Story = { args: { links: [] } }

/** A site set up this morning: the landmark and the name, and nothing empty around them. */
export const NameOnly: Story = {
  args: { links: [], social: [], contact: { address: [], phone: null, email: null } },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { MenuLink } from '@/content/types'

import { SiteHeader } from './SiteHeader'

const link = (label: string, href: string, newTab = false): MenuLink => ({
  id: label,
  label,
  href,
  newTab,
})

const primary = [
  link('About', '/about'),
  link('Academics', '/academics'),
  link('Calendar', '/calendar'),
  link('Families', '/families'),
  link('Contact', '/contact'),
]

const utility = [
  link('Parent portal', 'https://portal.example.org', true),
  link('Staff email', 'https://outlook.office.com', true),
]

const meta = {
  title: 'Site/SiteHeader',
  component: SiteHeader,
  args: {
    siteName: 'Summerville Middle School',
    primary,
    utility,
    currentPath: '/calendar',
    locale: 'en',
    locales: ['en', 'es'],
  },
} satisfies Meta<typeof SiteHeader>

export default meta

type Story = StoryObj<typeof meta>

/** "Calendar" is the current page: heavier, and announced as current. */
export const Default: Story = {}

/** A tenant created this morning — no `navigation` row yet. A name, and no empty landmarks. */
export const NoMenus: Story = { args: { primary: [], utility: [], locales: ['en'] } }

/**
 * The ceiling: eight main links and six quick links, with long labels. Narrow the preview to
 * 320px — every link stays, in order, on more rows.
 */
export const FullMenus: Story = {
  args: {
    siteName: 'Dorchester School District Two Early Childhood Center',
    primary: [
      ...primary,
      link('Athletics and activities', '/athletics'),
      link('Counseling and student services', '/counseling'),
      link('Media center', '/media-center'),
    ],
    utility: [
      ...utility,
      link('Lunch menus', '/lunch'),
      link('Bus routes', '/buses'),
      link('Report an absence', '/absence'),
      link('Employment', 'https://jobs.example.org', true),
    ],
    locales: ['en', 'es', 'zh-Hans', 'ko', 'pt', 'ar'],
  },
}

/**
 * The site's primary logo beside its name (Jason, 2026-11-18; Site settings), in the same link —
 * the logo silent (empty alt), the name naming the link.
 */
export const WithLogo: Story = {
  args: {
    logo: {
      src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><circle cx='60' cy='60' r='58' fill='%232b3170'/><circle cx='60' cy='60' r='30' fill='%2399a1e7'/></svg>",
      srcSet: '',
      width: 120,
      height: 120,
      alt: 'Dorchester School District Two',
    },
  },
}

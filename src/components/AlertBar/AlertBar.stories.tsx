import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { AlertBar } from './AlertBar'

/**
 * The alert banners (Jason, 2026-11-12). Each story is in the component axe gate, LTR and RTL.
 */
const meta = {
  title: 'Site/AlertBar',
  component: AlertBar,
} satisfies Meta<typeof AlertBar>

export default meta

type Story = StoryObj<typeof meta>

export const Emergency: Story = {
  args: {
    alerts: [
      {
        id: '1',
        severity: 'emergency',
        text: 'Schools are closed on Tuesday, January 14 because of snow and ice.',
        link: { href: '/closures', label: 'Closure details' },
        dismissible: false,
        version: 'a',
      },
    ],
  },
}

export const Warning: Story = {
  args: {
    alerts: [
      {
        id: '2',
        severity: 'warning',
        text: 'Schools open 2 hours late on Friday, January 17.',
        link: null,
        dismissible: true,
        version: 'a',
      },
    ],
  },
}

export const Notice: Story = {
  args: {
    alerts: [
      {
        id: '3',
        severity: 'info',
        text: 'Weather advisory: heavy rain this afternoon.',
        link: { href: 'https://www.weather.gov', label: 'Forecast' },
        dismissible: true,
        version: 'a',
      },
    ],
  },
}

/** Several at once: emergencies first, as `getAlerts` sorts them. */
export const Several: Story = {
  args: {
    alerts: [
      ...(Emergency.args?.alerts ?? []),
      ...(Warning.args?.alerts ?? []),
      ...(Notice.args?.alerts ?? []),
    ],
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Link } from './Link'

const meta = {
  title: 'Foundation/Link',
  component: Link,
} satisfies Meta<typeof Link>

export default meta

type Story = StoryObj<typeof meta>

export const Internal: Story = {
  args: { href: '/about', children: 'About the district' },
}

export const External: Story = {
  args: { href: 'https://www.berkeleycountysc.gov', children: 'Berkeley County' },
}

/** The notice is in the accessible name only — inspect with a screen reader, not by eye. */
export const OpensInANewWindow: Story = {
  args: {
    href: 'https://forms.office.com/example',
    children: 'Registration form',
    newWindow: true,
  },
}

export const InRunningText: Story = {
  args: { href: '/calendar', children: 'the district calendar' },
  render: (args) => (
    <p>
      Meeting dates are published on <Link {...args} />, which is underlined rather than
      distinguished by color alone.
    </p>
  ),
}

/**
 * The button variant — a page's primary action (`CallToAction`). Still an `<a>`: it
 * navigates, so it announces itself as a link and works before hydration.
 *
 * This is the one place the underline comes off, and the axe gate is what holds the trade
 * honest — the filled brand pair is contrast-checked in both themes and both directions.
 */
export const AsAButton: Story = {
  args: { href: '/enroll', children: 'Start enrollment', variant: 'button' },
}

/**
 * A translated label runs half again as long. It must wrap inside the affordance rather than
 * clip, which is why the variant is `inline-block` rather than a fixed-height pill (`08` §6).
 */
export const ButtonWithALongLabel: Story = {
  args: {
    href: '/enroll',
    children: 'Anmeldung für das kommende Schuljahr beginnen',
    variant: 'button',
  },
}

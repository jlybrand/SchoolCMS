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
      distinguished by colour alone.
    </p>
  ),
}

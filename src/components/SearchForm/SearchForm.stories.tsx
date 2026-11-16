import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { SearchForm } from './SearchForm'

/**
 * The site search box (Jason, 2026-11-16; Phase 6 D): compact in the header, labelled on the
 * results page.
 */
const meta = {
  title: 'Components/SearchForm',
  component: SearchForm,
} satisfies Meta<typeof SearchForm>

export default meta

type Story = StoryObj<typeof meta>

/** As in the header: the label is read, the button shows. */
export const InTheHeader: Story = {
  args: { action: '/search', id: 'site-search', landmark: 'Site search' },
}

/** On the results page: a visible label, the words kept. */
export const OnTheResultsPage: Story = {
  args: {
    action: '/search',
    id: 'page-search',
    landmark: 'Search again',
    label: 'Search Sheridan High School',
    query: 'bus routes',
    showLabel: true,
  },
}

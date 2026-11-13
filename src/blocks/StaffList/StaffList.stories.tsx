import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { ResolvedStaffListBlock, StaffMember } from '@/content/types'

import { StaffList } from './StaffList'

/**
 * A staff list, as the resolve pass hands it over (Jason, 2026-11-13) — ready staff, A–Z. No
 * empty story: an empty list renders nothing, and the component axe gate waits for the root to
 * have a child (see `ChildPageNav.stories.tsx`).
 */
const meta = {
  title: 'Blocks/StaffList',
  component: StaffList,
} satisfies Meta<typeof StaffList>

export default meta

type Story = StoryObj<typeof meta>

const person = (name: string, title: string | null, email: string | null): StaffMember => ({
  id: name,
  name,
  title,
  email,
})

const counselors: StaffMember[] = [
  person('Maria de la Cruz', 'School Counselor', 'maria.delacruz@example.org'),
  person('Casey Sample', 'School Counselor (Director)', 'casey.sample@example.org'),
  person('Jane Smith', 'School Counselor', null),
]

const block = (overrides: Partial<ResolvedStaffListBlock> = {}): ResolvedStaffListBlock => ({
  kind: 'staffList',
  id: 'staff',
  heading: 'Counselors',
  staff: counselors,
  ...overrides,
})

export const SubGroup: Story = { args: { block: block(), baseLevel: 2 } }

export const NoHeading: Story = { args: { block: block({ heading: null }), baseLevel: 2 } }

/** Ten or more: a name filter appears above the list. */
export const WholeSchool: Story = {
  args: {
    baseLevel: 2,
    block: block({
      heading: 'All staff',
      staff: [
        'Avery Mockwell|Teacher',
        'Blake Testman|Teacher',
        'Casey Sample|School Counselor',
        'Dana Example|Nurse',
        'Emery Placeholder|Media Specialist',
        'Finley Fixture|Admin/teacher',
        'Gray Stub|Secretary',
        'José Álvarez|Teaching Assistant',
        'Kim Sampleton|Special Education Paraprofessional',
        'Lee Mockford|Custodial',
        'Morgan Testa|School Psychologist',
      ].map((row) => {
        const [name = '', title = ''] = row.split('|')
        return person(name, title, `${name.toLowerCase().replace(/\W+/g, '.')}@example.org`)
      }),
    }),
  },
}

import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { CalendarEvent, ResolvedCalendarBlock } from '@/content/types'
import { toGridMonths, weekdayNames } from '@/lib/calendar-view'
import { toEventOccurrences } from '@/lib/event-format'
import { monthsFrom } from '@/lib/month-grid'

import { Calendar } from './Calendar'

/**
 * A calendar, as the resolve pass hands it over (Jason, 2026-11-11) — every date already written
 * out. Built here with the same pure functions the resolve pass uses, so the stories show what a
 * page shows. No empty-list story: an empty list renders nothing, and the component axe gate
 * waits for the root to have a child (see `ChildPageNav.stories.tsx`).
 */
const meta = {
  title: 'Blocks/Calendar',
  component: Calendar,
} satisfies Meta<typeof Calendar>

export default meta

type Story = StoryObj<typeof meta>

const NY = 'America/New_York'
const paragraph = (text: string) => ({
  kind: 'paragraph' as const,
  children: [{ kind: 'text' as const, text, marks: [] }],
})

const event = (
  id: string,
  title: string,
  timing: Partial<CalendarEvent['timing']> & { start: string },
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  tenantId: '1',
  calendarId: '1',
  title,
  location: null,
  notes: [],
  ...extra,
  timing: { end: null, allDay: false, repeat: 'none', repeatUntil: null, ...timing },
})

const EVENTS: CalendarEvent[] = [
  event(
    'concert',
    'Winter concert',
    { start: '2026-12-04T23:00:00.000Z', end: '2026-12-05T01:00:00.000Z' },
    {
      location: 'Auditorium',
      notes: [
        paragraph('Doors open at 5:30. Students should arrive by 5:15 in concert black.'),
        paragraph('The concert is free; donations support the music program.'),
      ],
    },
  ),
  event(
    'board',
    'School board meeting',
    { start: '2026-12-01T23:30:00.000Z', repeat: 'monthly', repeatUntil: '2027-06-01' },
    { location: 'District office', notes: [paragraph('Agenda posted the Friday before.')] },
  ),
  event('break', 'Winter break — schools closed', {
    start: '2026-12-21T05:00:00.000Z',
    end: '2027-01-01T05:00:00.000Z',
    allDay: true,
  }),
  event(
    'game',
    'Basketball vs. Ashley Ridge',
    { start: '2026-12-11T23:30:00.000Z' },
    { location: 'Main gym' },
  ),
]

const range = { from: '2026-12-01', to: '2027-11-30' }
const occurrences = (locale: string) => toEventOccurrences(EVENTS, range, { locale, timeZone: NY })

const list = (overrides: Partial<ResolvedCalendarBlock> = {}): ResolvedCalendarBlock =>
  ({
    kind: 'calendar',
    id: 'calendar',
    heading: 'Upcoming events',
    display: 'list',
    events: occurrences('en').slice(0, 5),
    ...overrides,
  }) as ResolvedCalendarBlock

const grid = (events = occurrences('en')): ResolvedCalendarBlock => ({
  kind: 'calendar',
  id: 'calendar',
  heading: 'District calendar',
  display: 'grid',
  weekdays: weekdayNames('en'),
  months: toGridMonths(events, {
    months: monthsFrom('2026-12-01', 12),
    today: '2026-12-04',
    locale: 'en',
  }),
  events,
})

/** The next events; click one with notes to read them. */
export const List: Story = { args: { block: list(), baseLevel: 2 } }

/** Without a heading, the event titles take the block's own level. */
export const ListWithoutAHeading: Story = {
  args: { block: list({ heading: null }), baseLevel: 2 },
}

/** A month like a paper calendar; click an event for its details and notes. */
export const Grid: Story = { args: { block: grid(), baseLevel: 2 } }

/** An empty month is still a calendar. */
export const EmptyGrid: Story = { args: { block: grid([]), baseLevel: 2 } }

/** Narrow: the month's events as a list instead of seven cramped columns. */
export const GridOnAPhone: Story = {
  args: { block: grid(), baseLevel: 2 },
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '22rem' }}>
        <Story />
      </div>
    ),
  ],
}

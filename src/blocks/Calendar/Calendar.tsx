import { Heading, nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { RichText } from '@/components/RichText'
import { Section } from '@/components/Section'
import type { CalendarMonth, EventOccurrence, ResolvedCalendarBlock } from '@/content/types'

import { CalendarFilterRoot, CalendarToolbar, FilteredList } from './CalendarFilter'
import { EventDialogButton } from './EventDialogButton'
import { MonthSwitcher } from './MonthSwitcher'
import styles from './Calendar.module.css'

/**
 * A calendar on a page (Jason, 2026-11-11) — Finalsite's calendar element, in its two most-used
 * forms:
 *
 *   - **List**: the next events, as many as the district chose. Each event's date, time and place
 *     are always shown; its notes open under it when clicked — a native `<details>`, so it works
 *     before any script and the browser announces open and closed (as `Accordion`).
 *   - **Grid**: a month like a paper calendar, with previous and next. Clicking an event opens
 *     its details and notes in a native `<dialog>`. On a narrow screen the table, which cannot
 *     fit seven columns legibly, gives way to the month's events as a list — CSS swaps them, so
 *     only one is ever exposed to assistive technology.
 *
 * HANDED ITS EVENTS, never fetching them: `resolvePageBlocks` loaded them and wrote out every
 * date and time (CLAUDE.md rule 1).
 *
 * THE OUTLINE: a named region whose heading is the block's level; event titles (list) and the
 * month's name (grid) sit one below. Without a heading they take the block's level, so no level is
 * skipped wherever the district places it (`03` §3.2).
 *
 * FILTER, SUBSCRIBE AND PRINT (Jason, 2026-11-18 and 2026-11-19), as icons above the events:
 * the filter opens a dialog of the calendars the block pulls in, all on at first; Subscribe is
 * one link to what is on; Print prints this calendar as it is on screen (`CalendarFilter`). Every event is still rendered here, tagged with its calendar; the filter only
 * chooses which `FilteredList` shows.
 *
 * Small client components — the month switcher, the button that opens an event, and the filter —
 * are the public site's only script here; everything else renders on the server.
 */
export type CalendarProps = {
  readonly block: ResolvedCalendarBlock
  readonly baseLevel: HeadingLevel
}

/** "Friday, December 4, 2026 · 6:00 – 8:00 PM" */
const When = ({ occurrence }: { readonly occurrence: EventOccurrence }) => (
  <p className={styles.when}>
    <time dateTime={occurrence.start}>{occurrence.dateLabel}</time>
    {occurrence.timeLabel === null ? null : <> · {occurrence.timeLabel}</>}
  </p>
)

const Where = ({ occurrence }: { readonly occurrence: EventOccurrence }) =>
  occurrence.location === null ? null : <p className={styles.where}>{occurrence.location}</p>

const EventList = ({
  events,
  level,
  limit,
}: {
  readonly events: readonly EventOccurrence[]
  readonly level: HeadingLevel
  readonly limit: number
}) => (
  <FilteredList
    as="ol"
    className={styles.list}
    empty={<p className={styles.when}>No events from the chosen calendars.</p>}
    items={events.map((occurrence) => {
      const title = (
        <Heading level={level} size="lg">
          {occurrence.title}
        </Heading>
      )
      const facts = (
        <>
          <When occurrence={occurrence} />
          <Where occurrence={occurrence} />
        </>
      )
      const node = (
        <li className={styles.item}>
          {occurrence.notes.length === 0 ? (
            <div className={styles.plain}>
              {title}
              {facts}
            </div>
          ) : (
            <details className={styles.details}>
              <summary className={styles.summary}>
                {title}
                {facts}
              </summary>
              <div className={styles.notes}>
                <RichText baseLevel={nextHeadingLevel(level)} content={occurrence.notes} />
              </div>
            </details>
          )}
        </li>
      )
      return { key: occurrence.key, calendarId: occurrence.calendarId, node }
    })}
    limit={limit}
  />
)

const dialogIdOf = (blockId: string, key: string) => `${blockId}-event-${key}`

/** What clicking an event opens: its title, when, where, and its notes. */
const EventDialog = ({
  blockId,
  occurrence,
  level,
}: {
  readonly blockId: string
  readonly occurrence: EventOccurrence
  readonly level: HeadingLevel
}) => {
  const id = dialogIdOf(blockId, occurrence.key)
  return (
    <dialog aria-labelledby={`${id}-title`} className={styles.dialog} id={id}>
      <form className={styles.close} method="dialog">
        <button className={styles.closeButton} type="submit">
          Close
        </button>
      </form>
      <Heading id={`${id}-title`} level={level} size="lg">
        {occurrence.title}
      </Heading>
      <When occurrence={occurrence} />
      <Where occurrence={occurrence} />
      {occurrence.notes.length === 0 ? null : (
        <div className={styles.dialogNotes}>
          <RichText baseLevel={nextHeadingLevel(level)} content={occurrence.notes} />
        </div>
      )}
    </dialog>
  )
}

const MonthPanel = ({
  blockId,
  month,
  weekdays,
  byKey,
  labelId,
}: {
  readonly blockId: string
  readonly month: CalendarMonth
  readonly weekdays: readonly { short: string; long: string }[]
  readonly byKey: ReadonlyMap<string, EventOccurrence>
  readonly labelId: string
}) => {
  const open = (key: string, className: string, children: React.ReactNode) => (
    <EventDialogButton className={className} dialogId={dialogIdOf(blockId, key)}>
      {children}
    </EventDialogButton>
  )
  /** The occurrences behind `keys`, each as the `<li>` `toNode` makes, for `FilteredList`. */
  const itemsOf = (keys: readonly string[], toNode: (o: EventOccurrence) => React.ReactNode) =>
    keys.flatMap((key) => {
      const o = byKey.get(key)
      return o === undefined ? [] : [{ key, calendarId: o.calendarId, node: toNode(o) }]
    })
  return (
    <>
      <table aria-labelledby={labelId} className={styles.table}>
        <thead>
          <tr>
            {weekdays.map((day) => (
              <th key={day.long} scope="col">
                <abbr title={day.long}>{day.short}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {month.weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day, d) =>
                day === null ? (
                  <td className={styles.outside} key={d} />
                ) : (
                  <td
                    aria-current={day.isToday ? 'date' : undefined}
                    className={styles.day}
                    key={day.date}
                  >
                    <span className={styles.dayNumber}>{day.day}</span>
                    <FilteredList
                      className={styles.dayEvents}
                      items={itemsOf(day.eventKeys, (o) => (
                        <li>{open(o.key, styles.dayEvent ?? '', o.title)}</li>
                      ))}
                    />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.agenda}>
        <FilteredList
          className={styles.list}
          empty={<p className={styles.when}>No events this month.</p>}
          items={itemsOf(month.eventKeys, (o) => (
            <li className={styles.item}>
              {open(o.key, styles.agendaEvent ?? '', o.title)}
              <When occurrence={o} />
            </li>
          ))}
        />
      </div>
    </>
  )
}

export const Calendar = ({ block, baseLevel }: CalendarProps) => {
  if (block.display === 'list' && block.events.length === 0) return null

  const body = (level: HeadingLevel) => {
    if (block.display === 'list')
      return (
        <>
          <CalendarToolbar />
          <EventList events={block.events} level={level} limit={block.limit} />
        </>
      )
    const byKey = new Map(block.events.map((o) => [o.key, o]))
    const labelId = `${block.id}-month`
    return (
      <div className={styles.grid}>
        <CalendarToolbar />
        <MonthSwitcher
          labelId={labelId}
          labels={block.months.map((m) => m.label)}
          level={level}
          panels={block.months.map((month) => (
            <MonthPanel
              blockId={block.id}
              byKey={byKey}
              key={month.key}
              labelId={labelId}
              month={month}
              weekdays={block.weekdays}
            />
          ))}
        />
        {block.events.map((occurrence) => (
          <EventDialog
            blockId={block.id}
            key={occurrence.key}
            level={nextHeadingLevel(level)}
            occurrence={occurrence}
          />
        ))}
      </div>
    )
  }

  return (
    <CalendarFilterRoot
      calendars={block.calendars}
      className={styles.root}
      feedOrigin={block.feedOrigin}
    >
      {block.heading === null ? (
        body(baseLevel)
      ) : (
        <Section heading={block.heading} headingId={`${block.id}-heading`} level={baseLevel}>
          {body(nextHeadingLevel(baseLevel))}
        </Section>
      )}
    </CalendarFilterRoot>
  )
}

import { Heading, nextHeadingLevel } from '@/components/Heading'
import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import { RichText } from '@/components/RichText'
import { Section } from '@/components/Section'
import type { CalendarMonth, EventOccurrence, ResolvedCalendarBlock } from '@/content/types'

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
 * Two small client components — the month switcher and the button that opens a dialog — are
 * the public site's only script here; everything else renders on the server.
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
}: {
  readonly events: readonly EventOccurrence[]
  readonly level: HeadingLevel
}) => (
  <ol className={styles.list}>
    {events.map((occurrence) => {
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
      return (
        <li className={styles.item} key={occurrence.key}>
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
    })}
  </ol>
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
                    {day.eventKeys.length === 0 ? null : (
                      <ul className={styles.dayEvents}>
                        {day.eventKeys.map((key) => {
                          const o = byKey.get(key)
                          return o === undefined ? null : (
                            <li key={key}>{open(key, styles.dayEvent ?? '', o.title)}</li>
                          )
                        })}
                      </ul>
                    )}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.agenda}>
        {month.eventKeys.length === 0 ? (
          <p className={styles.when}>No events this month.</p>
        ) : (
          <ul className={styles.list}>
            {month.eventKeys.map((key) => {
              const o = byKey.get(key)
              return o === undefined ? null : (
                <li className={styles.item} key={key}>
                  {open(key, styles.agendaEvent ?? '', o.title)}
                  <When occurrence={o} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}

export const Calendar = ({ block, baseLevel }: CalendarProps) => {
  if (block.display === 'list' && block.events.length === 0) return null

  /**
   * "Subscribe to School A" for each calendar shown (Jason, 2026-11-11): a `webcal:` link, so a
   * click opens the reader's calendar app to subscribe. The calendar's name is in the link's own
   * words, so each link makes sense read alone.
   */
  const subscribe =
    block.subscribe.length === 0 ? null : (
      <ul className={styles.subscribe}>
        {block.subscribe.map((calendar) => (
          <li key={calendar.href}>
            <Link href={calendar.href}>Subscribe to {calendar.name}</Link>
          </li>
        ))}
      </ul>
    )

  const body = (level: HeadingLevel) => {
    if (block.display === 'list')
      return (
        <>
          <EventList events={block.events} level={level} />
          {subscribe}
        </>
      )
    const byKey = new Map(block.events.map((o) => [o.key, o]))
    const labelId = `${block.id}-month`
    return (
      <div className={styles.grid}>
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
        {subscribe}
      </div>
    )
  }

  if (block.heading === null) return body(baseLevel)

  return (
    <Section heading={block.heading} headingId={`${block.id}-heading`} level={baseLevel}>
      {body(nextHeadingLevel(baseLevel))}
    </Section>
  )
}

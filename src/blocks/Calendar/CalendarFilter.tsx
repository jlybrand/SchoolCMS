'use client'

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { VisuallyHidden } from '@/components/VisuallyHidden'
import { subscribeOptions, subscribeTarget, visibleItems } from '@/lib/calendar-filter'

import styles from './Calendar.module.css'

/**
 * A calendar block's FILTER and PRINT (Jason, 2026-11-18).
 *
 *   - **Filter** (a funnel icon): a button opening a native `<dialog>` with a checkbox per calendar the block
 *     pulls in — all on at first. A change applies at once; the dialog closes with Done or Escape
 *     and the browser returns focus to the button. Offered only when there are two or more.
 *   - **Subscribe** (a calendar icon, Jason 2026-11-19): ONE feed, following the filter — one
 *     calendar on is its own feed, several are their one feed on this site (`subscribeTarget`) —
 *     offered as Apple, Google, Outlook, and the standard iCal address (`SubscribeDialog`).
 *   - **Print** (a printer icon): prints what is on screen — this calendar, its current month or list, with the
 *     filter applied — and nothing else of the page (`Calendar.module.css`, `@media print`).
 *
 * The events are still server-rendered: each list hands `FilteredList` its items already built,
 * tagged with their calendar, and this only chooses which to show. The choice lives in memory, not
 * `localStorage` (CLAUDE.md), and resets on the next visit — every calendar on.
 */
type Calendar = { id: string; name: string; href: string }

type FilterState = {
  readonly calendars: readonly Calendar[]
  readonly feedOrigin: string
  readonly shown: ReadonlySet<string>
  readonly setShown: (next: ReadonlySet<string>) => void
  readonly print: () => void
}

const FilterContext = createContext<FilterState | null>(null)

export type CalendarFilterRootProps = {
  readonly calendars: readonly Calendar[]
  /** Where several calendars' one feed is: this site's `webcal://host[:port]`. */
  readonly feedOrigin: string
  readonly className?: string | undefined
  readonly children: ReactNode
}

/** Holds the choice, and marks the block as the one being printed while it is. */
export const CalendarFilterRoot = ({
  calendars,
  feedOrigin,
  className,
  children,
}: CalendarFilterRootProps) => {
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(calendars.map((c) => c.id)))
  const [printing, setPrinting] = useState(false)

  // Print once the mark is on the page, and take it off when the print dialog closes.
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    window.print()
    return () => window.removeEventListener('afterprint', done)
  }, [printing])

  return (
    <FilterContext.Provider
      value={{ calendars, feedOrigin, shown, setShown, print: () => setPrinting(true) }}
    >
      <div className={className} data-calendar-printing={printing ? '' : undefined}>
        {children}
      </div>
    </FilterContext.Provider>
  )
}

export type FilteredItem = {
  readonly key: string
  readonly calendarId: string
  readonly node: ReactNode
}

export type FilteredListProps = {
  readonly items: readonly FilteredItem[]
  /** A list block's number: counts what is shown, after the filter. */
  readonly limit?: number
  /** In place of the list when nothing is left to show. */
  readonly empty?: ReactNode
  readonly as?: 'ol' | 'ul'
  readonly className?: string | undefined
}

/** The items on the calendars that are on — each item's `node` is its own `<li>`. */
export const FilteredList = ({
  items,
  limit,
  empty = null,
  as = 'ul',
  className,
}: FilteredListProps) => {
  const state = useContext(FilterContext)
  const shown = state?.shown ?? new Set(items.map((item) => item.calendarId))
  const visible = visibleItems(items, shown, limit)
  if (visible.length === 0) return <>{empty}</>
  const List = as
  return (
    <List className={className}>
      {visible.map((item) => (
        <Fragment key={item.key}>{item.node}</Fragment>
      ))}
    </List>
  )
}

/**
 * The toolbar's icons (Jason, 2026-11-19: icons, not words): a funnel and a printer. Drawn in
 * `currentColor`, hidden from assistive technology — each button is named in words
 * (`VisuallyHidden`), and `title` shows the same words on hover.
 */
const FilterIcon = () => (
  <svg aria-hidden="true" className={styles.icon} focusable="false" viewBox="0 0 24 24">
    <path
      d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

const SubscribeIcon = () => (
  <svg aria-hidden="true" className={styles.icon} focusable="false" viewBox="0 0 24 24">
    <path
      d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M12 13v5M9.5 15.5h5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

const PrintIcon = () => (
  <svg aria-hidden="true" className={styles.icon} focusable="false" viewBox="0 0 24 24">
    <path
      d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  </svg>
)

/**
 * Where to subscribe (Jason, 2026-11-19: "an iCal feed, standard, Google, Outlook, Apple"): a link
 * for each app, and the standard address with a Copy button for any other. Every one is the same
 * feed — what the filter has on.
 */
const SubscribeDialog = ({
  id,
  label,
  options,
  copied,
  onCopied,
  dialogRef,
}: {
  readonly id: string
  readonly label: string
  readonly options: ReturnType<typeof subscribeOptions>
  readonly copied: boolean
  readonly onCopied: () => void
  readonly dialogRef: React.RefObject<HTMLDialogElement | null>
}) => (
  <dialog aria-labelledby={`${id}-title`} className={styles.dialog} ref={dialogRef}>
    <p className={styles.filterTitle} id={`${id}-title`}>
      {label}
    </p>
    <ul className={styles.subscribeOptions}>
      <li>
        <a href={options.apple}>Apple Calendar</a>
      </li>
      <li>
        <a href={options.google}>Google Calendar</a>
      </li>
      <li>
        <a href={options.outlook}>Outlook.com</a>
      </li>
      <li>
        <a href={options.outlook365}>Outlook (Microsoft 365)</a>
      </li>
    </ul>
    <label className={styles.feedLabel} htmlFor={`${id}-feed`}>
      iCal feed address, for any other calendar app
    </label>
    <div className={styles.feedRow}>
      <input
        className={styles.feedAddress}
        id={`${id}-feed`}
        onFocus={(event) => event.currentTarget.select()}
        readOnly
        type="text"
        value={options.feed}
      />
      <button
        className={styles.navButton}
        onClick={() => {
          void navigator.clipboard?.writeText(options.feed).then(onCopied, () => undefined)
        }}
        type="button"
      >
        Copy
      </button>
    </div>
    <p aria-live="polite" className={styles.filterStatus}>
      {copied ? 'Copied.' : ''}
    </p>
    <form className={styles.filterActions} method="dialog">
      <button className={styles.closeButton} type="submit">
        Done
      </button>
    </form>
  </dialog>
)

/** The Filter, Subscribe and Print buttons, and their dialogs. */
export const CalendarToolbar = () => {
  const state = useContext(FilterContext)
  const dialog = useRef<HTMLDialogElement>(null)
  const subscribeDialog = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const id = useId()
  if (!state) return null
  const { calendars, feedOrigin, shown, setShown, print } = state
  const filterable = calendars.length > 1
  const on = calendars.filter((c) => shown.has(c.id)).length
  const subscribe = subscribeTarget(calendars, shown, feedOrigin)

  const toggle = (calendarId: string, checked: boolean) => {
    const next = new Set(shown)
    if (checked) next.add(calendarId)
    else next.delete(calendarId)
    setShown(next)
  }

  return (
    <div className={styles.toolbar}>
      {filterable ? (
        <button
          aria-haspopup="dialog"
          className={styles.iconButton}
          onClick={() => dialog.current?.showModal()}
          title="Filter calendars"
          type="button"
        >
          <FilterIcon />
          <VisuallyHidden>Filter calendars</VisuallyHidden>
        </button>
      ) : null}
      {/* ONE Subscribe (Jason, 2026-11-19), following the filter: a dialog of where to subscribe
          to it — Apple, Google, Outlook, or the standard iCal address to copy. */}
      {subscribe ? (
        <button
          aria-haspopup="dialog"
          className={styles.iconButton}
          onClick={() => {
            setCopied(false)
            subscribeDialog.current?.showModal()
          }}
          title={subscribe.label}
          type="button"
        >
          <SubscribeIcon />
          <VisuallyHidden>{subscribe.label}</VisuallyHidden>
        </button>
      ) : null}
      <button
        className={styles.iconButton}
        onClick={print}
        title="Print this calendar"
        type="button"
      >
        <PrintIcon />
        <VisuallyHidden>Print this calendar</VisuallyHidden>
      </button>
      {/* Says how many are on when not all are; polite, so a change is heard from the dialog. */}
      <p aria-live="polite" className={styles.filterStatus}>
        {filterable && on < calendars.length
          ? `Showing ${on} of ${calendars.length} calendars`
          : ''}
      </p>
      {subscribe ? (
        <SubscribeDialog
          copied={copied}
          dialogRef={subscribeDialog}
          id={`${id}-subscribe`}
          label={subscribe.label}
          onCopied={() => setCopied(true)}
          options={subscribeOptions(subscribe.href, subscribe.name)}
        />
      ) : null}
      {filterable ? (
        <dialog aria-labelledby={`${id}-title`} className={styles.dialog} ref={dialog}>
          <form method="dialog">
            <fieldset className={styles.filterChoices}>
              <legend className={styles.filterTitle} id={`${id}-title`}>
                Calendars to show
              </legend>
              {calendars.map((calendar) => (
                <label className={styles.filterChoice} key={calendar.id}>
                  <input
                    checked={shown.has(calendar.id)}
                    onChange={(event) => toggle(calendar.id, event.currentTarget.checked)}
                    type="checkbox"
                  />{' '}
                  {calendar.name}
                </label>
              ))}
            </fieldset>
            <div className={styles.filterActions}>
              <button
                className={styles.navButton}
                disabled={on === calendars.length}
                onClick={(event) => {
                  event.preventDefault()
                  setShown(new Set(calendars.map((c) => c.id)))
                }}
                type="button"
              >
                Show all
              </button>
              <button className={styles.closeButton} type="submit">
                Done
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  )
}

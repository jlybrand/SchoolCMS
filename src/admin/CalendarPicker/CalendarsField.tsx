'use client'

import { useConfig, useField } from '@payloadcms/ui'
import type { RelationshipFieldClientComponent } from 'payload'
import { useEffect, useMemo, useState } from 'react'

import { calendarsBySite, toggleCalendar, type SiteCalendars } from './calendar-choices'
import styles from './CalendarsField.module.css'

/**
 * A calendar block's calendars (Jason, 2026-11-19: "swap for checkboxes"): every calendar as a
 * checkbox under its site — the district first, then the schools A–Z — ticked in, unticked out.
 * Payload's multi-select hid that a block takes several (a chip and an arrow), and its chips fail
 * axe (`docs/phases/04` §17), as the grants and staff-members fields found before.
 *
 * STORES WHAT PAYLOAD'S FIELD STORES — the `calendars` relationship's ids, in the order ticked
 * (the block lists its subscribe links and filter in that order) — so the save, the required
 * rule, the resolve pass and the API are unchanged. Any site's calendars: the field is
 * `crossTenant` (`src/lib/cross-tenant-relationships.ts`), and the block is district-only.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/calendar.spec.ts`.
 */
const idOf = (item: unknown): string | null => {
  if (item === null || item === undefined) return null
  if (typeof item === 'object') {
    const value =
      (item as { id?: unknown; value?: unknown }).id ?? (item as { value?: unknown }).value
    return value === undefined || value === null ? null : String(value)
  }
  return String(item)
}

/** Back to the stored id type: Postgres ids are numbers. */
const stored = (id: string): number | string => (/^\d+$/.test(id) ? Number(id) : id)

export const CalendarsField: RelationshipFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue, disabled, showError, errorMessage } = useField<unknown[] | null>({
    potentiallyStalePath: path,
  })
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const [groups, setGroups] = useState<SiteCalendars[] | null>(null)

  useEffect(() => {
    let live = true
    const query = new URLSearchParams({
      limit: '0',
      depth: '1',
      'select[name]': 'true',
      'select[isMain]': 'true',
      'select[source]': 'true',
      'select[tenant]': 'true',
    })
    void fetch(`${api}/calendars?${query.toString()}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then((body: { docs?: Parameters<typeof calendarsBySite>[0] }) => {
        if (live) setGroups(calendarsBySite(body.docs ?? []))
      })
    return () => {
      live = false
    }
  }, [api])

  const chosen = useMemo(
    () => (Array.isArray(value) ? value.map(idOf).filter((id): id is string => id !== null) : []),
    [value],
  )
  const locked = Boolean(readOnly || disabled)
  const id = `field-${path.replace(/\./g, '__')}`
  const description =
    typeof field.admin?.description === 'string' ? field.admin.description : undefined
  const label = typeof field.label === 'string' ? field.label : 'Calendars'

  return (
    <fieldset
      aria-describedby={description ? `${id}-description` : undefined}
      aria-invalid={showError ? true : undefined}
      className={styles.field}
      id={id}
    >
      <legend className={styles.legend}>
        {label}
        {/* Payload's own mark for a required field, as on its other labels. */}
        {field.required ? <span className="required"> *</span> : null}
      </legend>
      {description ? (
        <p className={styles.description} id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      {showError && errorMessage ? (
        <p className={styles.error} role="alert">
          {errorMessage}
        </p>
      ) : null}
      {groups === null ? (
        <p className={styles.description}>Loading calendars…</p>
      ) : (
        groups.map((group) => (
          <fieldset className={styles.site} key={group.site}>
            <legend className={styles.siteName}>{group.site}</legend>
            {group.calendars.map((calendar) => {
              const boxId = `${id}-${calendar.id}`
              return (
                <div className={styles.option} key={calendar.id}>
                  <input
                    checked={chosen.includes(calendar.id)}
                    disabled={locked}
                    id={boxId}
                    onChange={(event) =>
                      setValue(
                        toggleCalendar(chosen, calendar.id, event.currentTarget.checked).map(
                          stored,
                        ),
                      )
                    }
                    type="checkbox"
                  />
                  <label htmlFor={boxId}>
                    {calendar.name}
                    {calendar.imported ? <span className={styles.note}> · imported</span> : null}
                  </label>
                </div>
              )
            })}
          </fieldset>
        ))
      )}
    </fieldset>
  )
}

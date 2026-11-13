'use client'

import { useConfig, useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useId, useMemo, useState } from 'react'

import { membersShown, toggleMember, type StaffRow } from './members'
import styles from './MembersField.module.css'

/**
 * Who is in a sub-group (Jason, 2026-11-13): the school's staff as a checklist, A–Z, with a name
 * filter — ticked in, unticked out. Native checkboxes in a fieldset, not Payload's multi-select,
 * whose chips fail axe (nested-interactive). Stores the `members` relationship as Payload's own
 * field would, so the save, the hook's check (`StaffGroups.ts`) and the API are unchanged.
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/people.spec.ts`, `tests/e2e/admin-planes-axe.spec.ts`.
 */
export const MembersField = ({ path }: { path: string }) => {
  const { value, setValue } = useField<(number | string)[] | null>({ path })
  const parent = useFormFields(([fields]) => fields.parent?.value) as number | string | null
  const {
    config: {
      routes: { api },
    },
  } = useConfig()
  const ids = useId()
  // Kept with the school it was loaded for, so a change of school shows "Loading" until its own.
  const [loaded, setLoaded] = useState<{ school: string; docs: StaffRow[] } | null>(null)
  const [filter, setFilter] = useState('')

  const school = parent === null || parent === undefined || parent === '' ? null : String(parent)
  const staff = school !== null && loaded?.school === school ? loaded.docs : null

  useEffect(() => {
    if (school === null) return
    let live = true
    const query = new URLSearchParams({
      'where[group][equals]': school,
      'where[active][equals]': 'true',
      sort: 'sortKey',
      limit: '0',
      depth: '0',
      'select[name]': 'true',
      'select[title]': 'true',
    })
    void fetch(`${api}/people?${query.toString()}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { docs: [] }))
      .then((body: { docs?: StaffRow[] }) => {
        if (live) setLoaded({ school, docs: body.docs ?? [] })
      })
    return () => {
      live = false
    }
  }, [api, school])

  const chosen = useMemo(() => (value ?? []).map(String), [value])
  const shown = useMemo(() => membersShown(staff ?? [], filter), [staff, filter])
  const filterId = `${ids}-filter`
  const countId = `${ids}-count`

  return (
    <fieldset className={styles.field} id="staff-group-members">
      <legend className={styles.legend}>Who’s in this group</legend>
      {school === null ? (
        <p className={styles.hint}>Choose the school first. Its staff will be listed here.</p>
      ) : staff === null ? (
        <p className={styles.hint}>Loading the school’s staff…</p>
      ) : staff.length === 0 ? (
        <p className={styles.hint}>No staff at this school yet. They come from CSI.</p>
      ) : (
        <>
          <p className={styles.hint} id={countId} role="status">
            {chosen.length} of {staff.length} ticked
          </p>
          <label className={styles.filterLabel} htmlFor={filterId}>
            Find by name
          </label>
          <input
            aria-describedby={countId}
            className={styles.filter}
            id={filterId}
            onChange={(event) => setFilter(event.target.value)}
            type="search"
            value={filter}
          />
          <ul className={styles.list}>
            {shown.map((person) => {
              const boxId = `${ids}-${String(person.id)}`
              return (
                <li className={styles.item} key={person.id}>
                  <input
                    checked={chosen.includes(String(person.id))}
                    id={boxId}
                    onChange={() => setValue(toggleMember(value ?? [], person.id))}
                    type="checkbox"
                  />
                  <label htmlFor={boxId}>
                    {person.name}
                    {person.title ? <span className={styles.title}> — {person.title}</span> : null}
                  </label>
                </li>
              )
            })}
          </ul>
          {shown.length === 0 ? <p className={styles.hint}>Nobody matches “{filter}”.</p> : null}
        </>
      )}
    </fieldset>
  )
}

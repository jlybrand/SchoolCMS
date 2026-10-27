'use client'

import { useField } from '@payloadcms/ui'
import type { SelectFieldClientComponent } from 'payload'

import styles from './Grants.module.css'

/**
 * `users.autoApprove` as a group of native checkboxes (`04` §4.3).
 *
 * The stored shape stays Payload's `select hasMany` — an array of scope strings — but its
 * react-select input fails the axe gate: an unnamed combobox and nested-interactive chips (see
 * `tests/e2e/auto-approval-grants.spec.ts`). A fieldset of labelled checkboxes passes, and reads
 * better for a choice of two.
 *
 * The district-only rule is the field's `access.update`; Payload hands this `readOnly` for
 * anyone else, and the server refuses the write regardless.
 */
export const GrantScopesField: SelectFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue, disabled } = useField<string[] | null>({ potentiallyStalePath: path })
  const chosen = Array.isArray(value) ? value : []
  const locked = Boolean(readOnly || disabled)
  const description =
    typeof field.admin?.description === 'string' ? field.admin.description : undefined
  const descriptionId = `${path}-description`

  const toggle = (scope: string, on: boolean) => {
    const next = on ? [...new Set([...chosen, scope])] : chosen.filter((s) => s !== scope)
    setValue(next)
  }

  return (
    <fieldset
      aria-describedby={description ? descriptionId : undefined}
      className={styles.fieldset}
      id={`field-${path}`}
    >
      <legend className={styles.legend}>Auto-approval</legend>
      {description ? (
        <p className={styles.description} id={descriptionId}>
          {description}
        </p>
      ) : null}
      {field.options.map((option) => {
        const scope = typeof option === 'string' ? option : option.value
        const label = typeof option === 'string' ? option : String(option.label)
        const id = `${path}-${scope.replace(/[^a-z0-9]+/gi, '-')}`
        return (
          <div className={styles.option} key={scope}>
            <input
              checked={chosen.includes(scope)}
              disabled={locked}
              id={id}
              onChange={(event) => toggle(scope, event.target.checked)}
              type="checkbox"
            />
            <label htmlFor={id}>{label}</label>
          </div>
        )
      })}
    </fieldset>
  )
}

'use client'

import { useField, useFormFields } from '@payloadcms/ui'
import type { RadioFieldClientComponent } from 'payload'
import { useState } from 'react'

import styles from './LinkModeField.module.css'

type Mode = 'none' | 'redirect' | 'reuse'

/** Jason's names (2026-11-11), each with what it does. */
const CHOICES: readonly { value: Exclude<Mode, 'none'>; label: string; hint: string }[] = [
  {
    value: 'redirect',
    label: 'Internal redirect',
    hint: 'Visitors are sent to another page on this site or the district site.',
  },
  {
    value: 'reuse',
    label: 'Reuse content',
    hint: "Visitors see a district page's title and content here, at this page's address.",
  },
]

/**
 * `pages.linkMode` on the Page settings' Linking tab (Jason, 2026-11-11): a checkbox "This page
 * is linked" and, when it is, the two kinds as pills — native radios, so the choice is one tab
 * stop with arrow keys and a screen reader hears a radio group (react-select chips fail axe,
 * `docs/phases/04` §17).
 *
 * THE STORED SHAPE IS UNCHANGED: one value, `none` | `redirect` | `reuse`. The checkbox is
 * `linkMode !== 'none'`; ticking it picks Internal redirect, the usual kind, and clearing it is
 * `none`. Validation is the field's own (`validateLinkMode`), shown here.
 *
 * District-only: the field's access refuses anyone else's write and its condition keeps it off
 * the school plane. A custom Field gets no wrapper from Payload, so the setting's classes
 * (`settingClass('linking')`) go on this one.
 */
export const LinkModeField: RadioFieldClientComponent = ({ field, path, readOnly }) => {
  const { value, setValue, disabled, valid, errorMessage } = useField<Mode | null>({
    potentiallyStalePath: path,
  })

  /**
   * WHY A SAVE WAS REFUSED, kept here until the linking changes. Payload's own `showError` does
   * not serve: this field's rule runs on the server only (`validateLinkMode`), and the form-state
   * round trip that follows a refusal sets `valid` back to true while leaving the old message —
   * so `valid` alone hides the reason at once, and `errorMessage` alone would show it forever.
   * Seen on a refusal, it stays until one of the linking settings changes (React's "state from
   * the previous render" pattern, not an effect).
   */
  const linking = useFormFields(([fields]) =>
    JSON.stringify(
      ['linkMode', 'linkTo', 'linkTarget', 'districtLinkTarget'].map((p) => fields[p]?.value),
    ),
  )
  const [refusal, setRefusal] = useState<{ message: string; linking: string } | null>(null)
  if (
    valid === false &&
    errorMessage &&
    (refusal?.message !== errorMessage || refusal.linking !== linking)
  ) {
    setRefusal({ message: errorMessage, linking })
  }
  const refused = refusal && refusal.linking === linking ? refusal.message : null
  const errorId = `${path}-error`
  const mode: Mode = value === 'redirect' || value === 'reuse' ? value : 'none'
  const linked = mode !== 'none'
  const locked = Boolean(readOnly || disabled)
  const description =
    typeof field.admin?.description === 'string' ? field.admin.description : undefined
  const chosen = CHOICES.find((choice) => choice.value === mode)

  return (
    <div
      className={[field.admin?.className, styles.field].filter(Boolean).join(' ')}
      id={`field-${path}`}
    >
      <p className={styles.error} id={errorId} role="alert">
        {refused}
      </p>
      <div className={styles.check}>
        <input
          aria-describedby={
            [refused ? errorId : null, description ? `${path}-description` : null]
              .filter(Boolean)
              .join(' ') || undefined
          }
          aria-invalid={refused ? true : undefined}
          checked={linked}
          disabled={locked}
          id={`${path}-linked`}
          onChange={(event) => setValue(event.target.checked ? 'redirect' : 'none')}
          type="checkbox"
        />
        <label htmlFor={`${path}-linked`}>This page is linked</label>
      </div>
      {description ? (
        <p className={styles.description} id={`${path}-description`}>
          {description}
        </p>
      ) : null}

      {linked ? (
        <fieldset className={styles.choices}>
          <legend className={styles.legend}>How it is linked</legend>
          <div className={styles.pills}>
            {CHOICES.map((choice) => (
              <span className={styles.pill} key={choice.value}>
                <input
                  checked={mode === choice.value}
                  disabled={locked}
                  id={`${path}-${choice.value}`}
                  name={path}
                  onChange={() => setValue(choice.value)}
                  type="radio"
                  value={choice.value}
                />
                <label htmlFor={`${path}-${choice.value}`}>{choice.label}</label>
              </span>
            ))}
          </div>
          {chosen ? <p className={styles.description}>{chosen.hint}</p> : null}
        </fieldset>
      ) : null}
    </div>
  )
}

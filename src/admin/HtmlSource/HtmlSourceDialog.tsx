'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import type { HtmlSourceResult } from '@/lib/html-source'

import styles from './HtmlSourceDialog.module.css'

/**
 * THE TEXT AS HTML (Jason, 2026-11-19: "select <> and the contents of the text editor are shown
 * in HTML5") — the dialog behind the toolbar's "HTML code".
 *
 * It opens with the whole text written as HTML (`lexicalToHtml`). The author can read it, change
 * it, or paste code in; "Update the text" CHECKS it (`htmlToLexical`, passed in as `check`):
 *
 *   - nothing taken out → the text is updated at once — the common case costs no second screen;
 *   - something taken out → "Before the text changes" names each removal in plain words, then
 *     "Update with the rest" or "Back to the code". Nothing is stripped unseen.
 *   - nothing left that could be kept, but something taken out → only "Back to the code".
 *
 * Unchanged code just closes. Cancel and Escape leave the text as it was. Each opening is a
 * fresh mount (the plugin keys it), so it always starts from the text as it is now.
 *
 * A native `<dialog>`, as `PastePrompt` is. Text in px, never under 15 (min-text-15px).
 */

/** What a code box is given. `label` is its accessible name — the visible label's words. */
export type CodeInputProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
}

export const CODE_LABEL = 'The text as HTML'

export type HtmlSourceDialogProps = {
  readonly open: boolean
  /** The text as HTML when the dialog opened. */
  readonly code: string
  readonly check: (code: string) => HtmlSourceResult
  /** The checked result — the text's new contents. The dialog closes after it. */
  readonly onApply: (result: HtmlSourceResult) => void
  readonly onClose: () => void
  /** For stories and tests: the code already edited to this, and checked. */
  readonly editedCode?: string
  /**
   * The code box. The editor passes Payload's code editor (`CodeBox`, Monaco); without one it is
   * a plain textarea — what Storybook and unit tests render, since Payload's editor needs
   * Payload's providers around it.
   */
  readonly codeInput?: (props: CodeInputProps) => ReactNode
}

export const HTML_SOURCE_TITLE = 'HTML code'

export const HtmlSourceDialog = ({
  open,
  code: original,
  check,
  onApply,
  onClose,
  editedCode,
  codeInput,
}: HtmlSourceDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const codeId = useId()
  const hintId = useId()
  const [code, setCode] = useState(editedCode ?? original)
  const [report, setReport] = useState<HtmlSourceResult | null>(() =>
    editedCode === undefined ? null : check(editedCode),
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const submit = () => {
    if (code === original) {
      onClose()
      return
    }
    const result = check(code)
    if (result.removals.length === 0) {
      onApply(result)
      return
    }
    setReport(result)
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className={styles.body}>
        {report === null ? (
          <>
            <h2 className={styles.title} id={titleId}>
              {HTML_SOURCE_TITLE}
            </h2>
            {codeInput ? (
              <p className={styles.label}>{CODE_LABEL}</p>
            ) : (
              <label className={styles.label} htmlFor={codeId}>
                {CODE_LABEL}
              </label>
            )}
            <p className={styles.hint} id={hintId}>
              Change it, or paste code in, then choose Update the text. It is checked first:
              headings, paragraphs, lists, links, quotes, lines and this text’s images are kept;
              anything else is taken out, and you will see what. Tab moves on from the code.
            </p>
            {codeInput ? (
              <div className={styles.codeBox}>
                {codeInput({ value: code, onChange: setCode, label: CODE_LABEL })}
              </div>
            ) : (
              <textarea
                autoFocus
                aria-describedby={hintId}
                className={styles.code}
                id={codeId}
                onChange={(event) => setCode(event.target.value)}
                rows={16}
                spellCheck={false}
                value={code}
              />
            )}
            <div className={styles.actions}>
              <button className={styles.button} onClick={onClose} type="button">
                Cancel
              </button>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={submit}
                type="button"
              >
                Update the text
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title} id={titleId}>
              {report.empty ? 'Nothing in this code can go in the text' : 'Before the text changes'}
            </h2>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Removed</h3>
              <ul className={styles.list}>
                {report.removals.map((removal) => (
                  <li key={removal.kind}>{removal.message}</li>
                ))}
              </ul>
            </section>
            <div className={styles.actions}>
              <button
                autoFocus={report.empty}
                className={`${styles.button} ${report.empty ? styles.primary : ''}`}
                onClick={() => setReport(null)}
                type="button"
              >
                Back to the code
              </button>
              {report.empty ? null : (
                <button
                  autoFocus
                  className={`${styles.button} ${styles.primary}`}
                  onClick={() => onApply(report)}
                  type="button"
                >
                  Update with the rest
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}

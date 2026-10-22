import type { PageDiff } from './page-diff'
import styles from './Approvals.module.css'

/**
 * The diff, rendered (`04` §4.2). Presentational only; `diffPage` decided what changed.
 *
 * Added and removed are said in WORDS ("Added", "Removed") and carried by a start-edge rule —
 * never colour alone (1.4.1). Body blocks are shown as text with their kind named, not as
 * real headings and lists: a body `h2` inside the queue would put the school's headings into
 * the queue's own outline, which is the reviewer's navigation.
 */
export const PageDiffView = ({ diff, titleId }: { diff: PageDiff; titleId: string }) => {
  const hasChanges = diff.fields.length > 0 || diff.body !== null
  if (!hasChanges) {
    return <p className={styles.muted}>No changes to what visitors see.</p>
  }

  return (
    <div className={styles.diff}>
      {diff.fields.length > 0 ? (
        <table className={styles.fields} aria-describedby={titleId}>
          <caption className={styles.caption}>
            {diff.isNew ? 'Details of the new page' : 'Changed details'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Detail</th>
              {diff.isNew ? null : <th scope="col">Now on the site</th>}
              <th scope="col">{diff.isNew ? 'Value' : 'After approval'}</th>
            </tr>
          </thead>
          <tbody>
            {diff.fields.map((field) => (
              <tr key={field.field}>
                <th scope="row">{field.label}</th>
                {diff.isNew ? null : (
                  <td>{field.before ?? <span className={styles.muted}>Empty</span>}</td>
                )}
                <td>{field.after ?? <span className={styles.muted}>Empty</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {diff.body ? (
        <div className={styles.body}>
          <p className={styles.caption}>
            {diff.isNew ? 'The words on the page' : 'Changes to the words on the page'}
            {diff.body.unchanged > 0
              ? ` (${diff.body.unchanged} ${diff.body.unchanged === 1 ? 'part' : 'parts'} unchanged)`
              : ''}
          </p>
          <ul className={styles.changes}>
            {diff.body.changes.map((change, index) => (
              <li className={styles.change} data-change={change.change} key={index}>
                <span className={styles.changeLabel}>
                  {change.change === 'added' ? 'Added' : 'Removed'}{' '}
                  {change.kind === 'heading'
                    ? 'heading'
                    : change.kind === 'list'
                      ? 'list'
                      : 'paragraph'}
                  :
                </span>
                {change.kind === 'list' ? (
                  <ul className={styles.listLines}>
                    {change.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={change.kind === 'heading' ? styles.headingLine : undefined}>
                    {' '}
                    {change.lines[0] === '' ? '(empty)' : change.lines[0]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

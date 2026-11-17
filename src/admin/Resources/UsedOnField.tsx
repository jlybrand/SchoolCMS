import type { UIFieldServerProps } from 'payload'

import { getFileUses } from './file-uses-data'
import styles from './UsedOnField.module.css'
import { UsesList } from './UsesList'

/**
 * "Where it's used" in a file's sidebar (Jason, 2026-11-17), on both planes: the PUBLISHED pages
 * and announcements showing this file, so an editor sees what a replace or a delete affects.
 * Worked out each time the file's page opens (`getFileUses`, read as the user; the rule is
 * `src/lib/file-uses.ts`). Nothing on a new file's screen.
 *
 * Styled from Payload's theme variables, as `ReviewStatusField` is: DD2 tokens aren't loaded in
 * the admin and don't follow its dark theme.
 */
export const UsedOnField = async ({ id, req }: UIFieldServerProps) => {
  if (id === undefined || id === null) return null
  const uses = await getFileUses(req, id)
  if (uses === null) return null

  return (
    <section
      aria-labelledby="used-on-heading"
      className={`field-type ${styles.usedOn}`}
      id="used-on"
    >
      <h2 className={styles.heading} id="used-on-heading">
        Where it’s used
      </h2>
      <UsesList uses={uses} />
    </section>
  )
}

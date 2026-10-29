import type { DefaultCellComponentProps } from 'payload'

import { LinkedIcon } from './LinkedIcon'
import styles from './LinkedPage.module.css'

/**
 * The "Linked page" column in the district's page list: the mark and the word for a linked
 * page, nothing for any other — an empty cell reads as "not linked" without saying it 300 times.
 */
export const LinkedPageCell = ({ cellData }: DefaultCellComponentProps) =>
  cellData === 'redirect' ? (
    <span className={styles.linked}>
      <LinkedIcon className={styles.icon} />
      Linked
    </span>
  ) : null

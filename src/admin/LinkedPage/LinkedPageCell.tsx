import type { DefaultCellComponentProps } from 'payload'

import { LinkedIcon } from './LinkedIcon'
import styles from './LinkedPage.module.css'

/**
 * The linked-page column in the district's page list: the mark alone for a linked page
 * (Jason, 2026-10-29), nothing for any other — an empty cell reads as "not linked" without
 * saying it 300 times.
 */
export const LinkedPageCell = ({ cellData }: DefaultCellComponentProps) =>
  cellData === 'redirect' ? <LinkedIcon className={styles.icon} /> : null

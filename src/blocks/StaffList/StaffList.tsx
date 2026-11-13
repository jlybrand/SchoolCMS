import type { HeadingLevel } from '@/components/Heading'
import { Section } from '@/components/Section'
import type { ResolvedStaffListBlock } from '@/content/types'

import { StaffDirectory } from './StaffDirectory'
import styles from './StaffList.module.css'

/**
 * A staff list on a page (Jason, 2026-11-13) — a school's staff, or a sub-group of them (SHS ›
 * Counselors). Finalsite calls it a constituent element. District only
 * (`src/access/school-layout.ts`).
 *
 * HANDED ITS STAFF, never fetching them: `resolvePageBlocks` read the group (`listStaff`), A–Z
 * by last name. This component only lays them out (CLAUDE.md rule 1).
 *
 * THE OUTLINE: with a heading, a named region whose heading is the block's level; without one,
 * just the list. People are list items, not headings — a hundred names would bury the page's
 * outline — so no level below the block's is used, and none is skipped.
 *
 * NOTHING TO SHOW, NOTHING RENDERED: the resolve pass drops an empty list; this agrees.
 */
export type StaffListProps = {
  readonly block: ResolvedStaffListBlock
  readonly baseLevel: HeadingLevel
}

export const StaffList = ({ block, baseLevel }: StaffListProps) => {
  if (block.staff.length === 0) return null

  const list = <StaffDirectory id={block.id} maxColumns={block.maxColumns} staff={block.staff} />

  /*
   * WIDER THAN THE TEXT WHEN IT NEEDS TO BE (Jason, 2026-11-13). Three or four across do not fit
   * the page's reading column, so the whole block — heading with its cards — widens, centred,
   * short of the screen's edges (`.block` in the stylesheet). One or two across stay put.
   */
  return (
    <div className={styles.block} data-max-columns={block.maxColumns}>
      {block.heading === null ? (
        list
      ) : (
        <Section heading={block.heading} headingId={`${block.id}-heading`} level={baseLevel}>
          {list}
        </Section>
      )}
    </div>
  )
}

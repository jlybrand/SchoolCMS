import type { HeadingLevel } from '@/components/Heading'
import { Link } from '@/components/Link'
import { Section } from '@/components/Section'
import type { ResolvedDocumentListBlock } from '@/content/types'

import styles from './DocumentList.module.css'

/**
 * A document list on a page (Jason, 2026-11-16) — every document in one folder of the site's
 * library, A–Z. In the school palette (`src/access/school-layout.ts`).
 *
 * HANDED ITS DOCUMENTS, never fetching them: `resolvePageBlocks` read the folder
 * (`listFolderDocuments`). This component only lays them out (CLAUDE.md rule 1).
 *
 * EACH LINK SAYS WHAT IT OPENS: the title, then the type and size — "Enrollment form (PDF,
 * 240 KB)" — inside the link, so it is read with it (WCAG 2.4.4).
 *
 * NOT YET CHECKED FOR ACCESSIBILITY (`07` §5): listed like the rest, with a note under it naming
 * whom to ask for an accessible copy. The platform records the status; it does not remediate.
 *
 * THE OUTLINE: with a heading, a named region whose heading is the block's level; without one,
 * just the list. Documents are list items, not headings, so no level is skipped.
 *
 * NOTHING TO SHOW, NOTHING RENDERED: the resolve pass drops an empty folder; this agrees.
 */
export type DocumentListProps = {
  readonly block: ResolvedDocumentListBlock
  readonly baseLevel: HeadingLevel
}

const fileDetails = (fileType: string, fileSize: string | null) =>
  fileSize === null ? fileType : `${fileType}, ${fileSize}`

export const DocumentList = ({ block, baseLevel }: DocumentListProps) => {
  if (block.documents.length === 0) return null

  const list = (
    <ul className={styles.list}>
      {block.documents.map((doc) => (
        <li className={styles.item} key={doc.id}>
          <Link href={doc.href}>
            {doc.title}{' '}
            <span className={styles.details}>({fileDetails(doc.fileType, doc.fileSize)})</span>
          </Link>
          {doc.description ? <p className={styles.description}>{doc.description}</p> : null}
          {doc.unchecked ? (
            <p className={styles.note}>
              This document may not be fully accessible. Contact {block.contactName} for an
              accessible copy.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )

  return block.heading === null ? (
    list
  ) : (
    <Section heading={block.heading} headingId={`${block.id}-heading`} level={baseLevel}>
      {list}
    </Section>
  )
}

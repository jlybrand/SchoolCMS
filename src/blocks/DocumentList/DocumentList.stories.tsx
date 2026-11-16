import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import type { DocumentItem, ResolvedDocumentListBlock } from '@/content/types'

import { DocumentList } from './DocumentList'

/**
 * A document list, as the resolve pass hands it over (Jason, 2026-11-16) — one folder's
 * documents, A–Z, one not yet checked for accessibility. No empty story: an empty list renders
 * nothing, and the component axe gate waits for the root to have a child.
 */
const meta = {
  title: 'Blocks/DocumentList',
  component: DocumentList,
} satisfies Meta<typeof DocumentList>

export default meta

type Story = StoryObj<typeof meta>

const doc = (title: string, over: Partial<DocumentItem> = {}): DocumentItem => ({
  id: title,
  title,
  href: `/api/resources/file/${encodeURIComponent(title)}.pdf`,
  fileType: 'PDF',
  fileSize: '240 KB',
  description: null,
  unchecked: false,
  ...over,
})

const block = (over: Partial<ResolvedDocumentListBlock> = {}): ResolvedDocumentListBlock => ({
  kind: 'documentList',
  id: 'documents',
  heading: 'Enrollment forms',
  contactName: 'Sheridan High School',
  documents: [
    doc('Allergy action plan', { unchecked: true }),
    doc('Bus request', {
      fileType: 'Word',
      fileSize: '48 KB',
      description: 'Fill in and return to the front office.',
    }),
    doc('School supply list 2026–27', { fileType: 'Excel', fileSize: '1.2 MB' }),
  ],
  ...over,
})

export const Default: Story = { args: { block: block(), baseLevel: 2 } }

export const NoHeading: Story = { args: { block: block({ heading: null }), baseLevel: 2 } }

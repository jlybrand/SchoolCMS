/**
 * The anchor of one queue item, so the form's "Review in the approval queue" lands on it.
 * Collection AND id: a page and an announcement can share an id. Its own file because the
 * button that links here is a client component and the queue's data module is not.
 */
export const approvalAnchor = (collection: string, id: number | string): string =>
  `approval-${collection}-${String(id)}`

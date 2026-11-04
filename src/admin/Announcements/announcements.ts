import type { SiteNode } from '@/admin/Boards/board-tree'

/**
 * The pure decisions under the announcements screen (Jason, 2026-11-04) — Finalsite's Posts
 * module: a site's folders, a folder's boards, a board's posts, and "Create post" at the top right
 * starting a post on that board. `AnnouncementsView` renders these; it decides nothing.
 */

const POSTS = '/admin/collections/posts'

/** The board named in the address — one plain number, or nothing. */
export const boardFromQuery = (query: unknown): string | null => {
  if (typeof query !== 'object' || query === null) return null
  const board = (query as { board?: unknown }).board
  return typeof board === 'string' && /^\d+$/.test(board) ? board : null
}

/** A board, open on the announcements screen. */
export const boardHref = (board: string): string => `${POSTS}?board=${board}`

/**
 * "Create post": the same screen, with the headline showing above the board's posts. Enter it and
 * the post exists on that board, so autosave covers the words from the first keystroke; then its
 * own form opens. Payload's create form is not used: it asks create access with no site named,
 * which a school manager is refused (by design — `postsCreateAccess`), and it cannot autosave
 * before the post's address exists.
 */
export const createPostHref = (board: string): string => `${POSTS}?board=${board}&new=1`

/** Whether the headline is showing (`createPostHref`). */
export const wantsNewPost = (query: unknown): boolean =>
  typeof query === 'object' && query !== null && (query as { new?: unknown }).new === '1'

export type FoundBoard = { site: string; folder: string; board: string; folderId: string }

/** The chosen board with its site and folder, or null when the viewer's tree does not hold it. */
export const findBoard = (tree: readonly SiteNode[], id: string | null): FoundBoard | null => {
  if (id === null) return null
  for (const site of tree) {
    for (const folder of site.folders) {
      const board = folder.boards.find((b) => b.id === id)
      if (board) {
        return { site: site.name, folder: folder.name, board: board.name, folderId: folder.id }
      }
    }
  }
  return null
}

/** The viewer's only board, if they have exactly one — the screen opens straight onto it. */
export const soleBoard = (tree: readonly SiteNode[]): string | null => {
  const all = tree.flatMap((site) => site.folders.flatMap((folder) => folder.boards))
  return all.length === 1 ? all[0]!.id : null
}

export type Audience = 'district' | 'school'

/**
 * Where a post stands, in one or two words. A waiting change comes first even on a published
 * post — it is what someone has to act on. A school is told in its own words: no "draft", no
 * "publish" (`04` §2.1).
 */
export const announcementStatus = (
  doc: { _status?: unknown; reviewState?: unknown },
  audience: Audience,
): string => {
  const school = audience === 'school'
  if (doc.reviewState === 'submitted') return school ? 'Sent for approval' : 'Waiting for approval'
  if (doc.reviewState === 'changes-requested') return school ? 'Needs changes' : 'Sent back'
  if (doc._status === 'published') return school ? 'On the website' : 'Published'
  return school ? 'Not sent yet' : 'Draft'
}

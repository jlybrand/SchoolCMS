import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { sendsForApproval } from '@/admin/SendForApproval/review-status'

/** Where the district chooses a board: Site → Folder → Board (`src/admin/Boards/`). */
export const BOARDS_PATH = '/admin/collections/post-boards'

export type NewPostRoute =
  { as: 'school' } | { as: 'district'; board: string } | { redirect: string }

/**
 * Who the new-announcement screen is for. Finalsite is board-first — open a board, then create a
 * post on it (Jason, 2026-10-29). A school picks its board on the screen itself; the district
 * arrives from the boards screen with `?board=<id>` already chosen, and without one is sent there
 * to choose. The board is only an address here: the view reads it as the user, and the create
 * is decided by access like any other.
 */
export const newPostRoute = (
  user: AuthUser | null | undefined,
  board: string | string[] | undefined,
): NewPostRoute => {
  if (sendsForApproval(user)) return { as: 'school' }
  if (!isDistrictAdmin(user)) return { redirect: '/admin' }
  if (typeof board !== 'string' || !/^\d+$/.test(board)) return { redirect: BOARDS_PATH }
  return { as: 'district', board }
}

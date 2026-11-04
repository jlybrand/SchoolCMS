import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { boardFromQuery, createPostHref } from '@/admin/Announcements/announcements'

/**
 * `/admin/new-post` — the landing view's "Post an announcement", and older links to the old
 * headline screen. Announcements are started on their board now (Jason, 2026-11-04), so this sends
 * the user there with the headline showing: on the board named, or — with none — on the screen,
 * which opens straight onto a school's board when it has only one. Nothing is decided here; the
 * announcements screen reads every board as the user.
 */
export const NewPostView = ({ searchParams }: AdminViewServerProps) => {
  const board = boardFromQuery(searchParams)
  redirect(board ? createPostHref(board) : '/admin/collections/posts?new=1')
}

import { ValidationError, type CollectionBeforeDeleteHook, type PayloadRequest } from 'payload'

/**
 * Deleting a site never deletes its content (2026-11-11).
 *
 * `plugin-multi-tenant` would delete every document of a deleted tenant (`cleanupAfterTenantDelete`,
 * on by default) — one mistaken click and a school's pages, announcements and events are gone
 * beyond undo. The cascade is off (src/payload.config.ts), and this refuses the delete while the
 * site still has content or staff, saying what to do first. Every other reference to a tenant is
 * "set null" in the database, so without this an emptied-and-deleted site would leave rows that
 * belong to no site; its own setup is therefore removed here, with it.
 */

/** Set while a site's setup is removed, so `keepMainCalendar` lets its own calendar go. */
export const DELETING_SITE = 'deletingSite'
export const isDeletingSite = (req: PayloadRequest): boolean =>
  req.context?.[DELETING_SITE] === true

const CONTENT = [
  { collection: 'pages', one: 'page', many: 'pages' },
  { collection: 'posts', one: 'announcement', many: 'announcements' },
  { collection: 'events', one: 'event', many: 'events' },
] as const

/** A site's own setup, removed with it — boards before the folders they sit in. */
const SETUP = [
  'calendars',
  'post-boards',
  'post-folders',
  'navigation',
  'theme',
  'settings',
] as const

const listed = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

export const refuseDeletingSiteWithContent: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const site = await req.payload.findByID({
    collection: 'tenants',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  const name = String((site as { name?: unknown } | null)?.name ?? 'This site')

  const content: string[] = []
  for (const { collection, one, many } of CONTENT) {
    const { totalDocs } = await req.payload.count({
      collection,
      where: { tenant: { equals: id } },
      overrideAccess: true,
      req,
    })
    if (totalDocs > 0) content.push(`${totalDocs} ${totalDocs === 1 ? one : many}`)
  }
  const { totalDocs: staff } = await req.payload.count({
    collection: 'users',
    where: { 'tenants.tenant': { equals: id } },
    overrideAccess: true,
    req,
  })

  const problems: string[] = []
  if (content.length > 0) {
    problems.push(
      `${name} still has ${listed(content)}. Delete or move them first — deleting a site never deletes its content.`,
    )
  }
  if (staff > 0) {
    problems.push(
      `${problems.length > 0 ? 'It' : name} still has ${staff} staff account${staff === 1 ? '' : 's'}. Remove the site from ${staff === 1 ? 'that account' : 'those accounts'} first.`,
    )
  }
  if (problems.length > 0) {
    throw new ValidationError({ errors: [{ path: 'name', message: problems.join(' ') }] })
  }

  for (const collection of SETUP) {
    await req.payload.delete({
      collection,
      where: { tenant: { equals: id } },
      overrideAccess: true,
      req,
      context: { [DELETING_SITE]: true },
    })
  }
}

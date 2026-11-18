import { Gutter, Pill } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { isDistrictAdmin } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { inPayloadFrame } from '@/admin/frame'
import { OpenPanelButton } from '@/admin/Nav/OpenPanelButton'
import { NewPageForm } from '@/admin/SchoolPlane/NewPageForm'
import { schoolEditPath } from '@/admin/SchoolPlane/school-plane'

import {
  NEW_PAGE_ANCHOR,
  pageTree,
  sitePagesHref,
  sitePagesParams,
  type PageNode,
} from './site-pages'
import styles from './SitePages.module.css'

/**
 * A site's pages (Jason, 2026-11-13; scope settled 2026-11-18), at `/admin/site-pages`: the
 * district's way in to pages. "Pages" in their menu opens "Choose a site"; the site opens here,
 * its pages as a tree. A title opens the page's form; "Add a page here" opens the new-page form
 * under that row, so the page is created where it belongs on the site.
 *
 * RENDERED FROM THE ADDRESS (`sitePagesParams`): Back, reloads and shared links work, and every
 * control is a link. Read AS THE USER — access decides — with drafts, so a page not live yet is
 * listed too. In Payload's frame, as the file library is (`inPayloadFrame`).
 *
 * District only; anyone else goes home. Built, then locked with Playwright + axe (CLAUDE.md's
 * exception for admin views): `tests/e2e/side-nav.spec.ts`.
 */
export const SitePagesView = async (props: AdminViewServerProps) => {
  const { req } = props.initPageResult
  const user = req.user as AuthUser | null
  if (!isDistrictAdmin(user)) redirect('/admin')

  const params = sitePagesParams((props.searchParams ?? {}) as Record<string, string | string[]>)
  const site = params.site
    ? await req.payload
        .findByID({
          collection: 'tenants',
          id: params.site,
          req,
          overrideAccess: false,
          depth: 0,
          select: { name: true },
        })
        .catch(() => null)
    : null

  const changeSite = (label: string) => (
    <OpenPanelButton className={styles.changeSite} id="site-pages-change" kind="pages">
      {label}
    </OpenPanelButton>
  )

  if (!site) {
    return inPayloadFrame(
      props,
      <Gutter>
        <div className={styles.view} id="site-pages">
          <h1 className={styles.title}>Pages</h1>
          <p>Choose the site whose pages you want to work on.</p>
          {changeSite('Choose a site')}
        </div>
      </Gutter>,
    )
  }

  const siteId = String(site.id)
  const siteName = typeof site.name === 'string' ? site.name : `Site ${siteId}`
  const pages = await req.payload.find({
    collection: 'pages',
    req,
    overrideAccess: false,
    draft: true,
    depth: 0,
    pagination: false,
    where: { tenant: { equals: site.id } },
    select: { title: true, slug: true, parent: true, _status: true, reviewState: true },
  })
  const tree = pageTree(pages.docs)
  const newPage = (parent?: string) => (
    <div className={styles.newPage} id={NEW_PAGE_ANCHOR}>
      <h2 className={styles.newPageTitle}>{parent ? 'New page here' : 'New top-level page'}</h2>
      <NewPageForm
        focusOnOpen
        schools={[{ id: site.id, name: siteName }]}
        // Page ids are numbers in Postgres; `sitePagesParams` only lets digits through.
        {...(parent ? { parent: Number(parent) } : {})}
      />
      <Link className={styles.cancel} href={sitePagesHref({ site: siteId })}>
        Cancel
      </Link>
    </div>
  )

  const rows = (nodes: readonly PageNode[]) => (
    <ul className={styles.tree}>
      {nodes.map((node) => (
        <li className={styles.item} key={node.id}>
          <div className={styles.row}>
            <Link className={styles.pageTitle} href={schoolEditPath('pages', node.id)}>
              {node.title}
            </Link>
            {node.frontPage ? <span className={styles.note}>Front page</span> : null}
            {node.orphan ? <span className={styles.note}>Its parent page is missing</span> : null}
            <span className={styles.pills}>
              {node.labels.map((label) => (
                <Pill key={label} rounded size="small">
                  {label}
                </Pill>
              ))}
            </span>
            {node.frontPage ? null : (
              <Link
                aria-label={`Add a page here, under ${node.title}`}
                className={styles.add}
                href={sitePagesHref({ site: siteId, new: node.id })}
              >
                Add a page here
              </Link>
            )}
          </div>
          {params.new === node.id && !node.frontPage ? newPage(node.id) : null}
          {node.children.length > 0 ? rows(node.children) : null}
        </li>
      ))}
    </ul>
  )

  return inPayloadFrame(
    props,
    <Gutter>
      <div className={styles.view} id="site-pages">
        <div className={styles.header}>
          <h1 className={styles.title}>Pages — {siteName}</h1>
          {changeSite('Change site')}
        </div>

        {tree.length === 0 ? (
          <p className={styles.muted}>This site has no pages yet.</p>
        ) : (
          rows(tree)
        )}

        {params.new === 'top' ? (
          newPage()
        ) : (
          <p>
            <Link className={styles.addTop} href={sitePagesHref({ site: siteId, new: 'top' })}>
              + New top-level page
            </Link>
          </p>
        )}
      </div>
    </Gutter>,
  )
}

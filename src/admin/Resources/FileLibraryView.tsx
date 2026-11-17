import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { AdminViewServerProps } from 'payload'

import { isDistrictAdmin, isSchoolManager } from '@/access/predicates'
import type { AuthUser } from '@/access/types'
import { fileSizeLabel, fileTypeLabel } from '@/content/document-item'
import { usesSummary } from '@/lib/file-uses'

import { getFileUses } from './file-uses-data'
import {
  folderTree,
  libraryHref,
  libraryParams,
  LIBRARY_PATH,
  type FolderNode,
  type LibraryParams,
} from './file-library'
import { FileDetails } from './FileDetails'
import styles from './FileLibrary.module.css'
import { getLibraryFile, librarySites, listLibraryFiles, listLibraryFolders } from './library-data'

/**
 * The file library (Jason, 2026-11-17), at `/admin/file-library`, both planes, beside Payload's
 * own Files list. Three columns on a wide screen: the site's FOLDERS, the FILES in the chosen
 * one, and the open file's DETAILS (`FileDetails`). The district chooses a site first.
 *
 * RENDERED FROM THE ADDRESS (`libraryParams`), so the back button, reloads and shared links
 * work. The site picker and the search are plain GET forms and every other control is a link,
 * so nothing navigates while someone is still choosing (WCAG 3.2.2). Reads are as the user AND
 * scoped to the site (`library-data.ts`).
 *
 * Built, then locked with Playwright + axe (CLAUDE.md's exception for admin views):
 * `tests/e2e/file-library.spec.ts`.
 */
export const FileLibraryView = async ({ initPageResult, searchParams }: AdminViewServerProps) => {
  const { req } = initPageResult
  const user = req.user as AuthUser | null
  if (!isDistrictAdmin(user) && !isSchoolManager(user)) redirect('/admin')

  const params = libraryParams((searchParams ?? {}) as Record<string, string | string[]>)
  const { sites, site, district } = await librarySites(req, params.site)
  const at: LibraryParams = { ...params, site: site?.id ?? null }
  const deleted = searchParams?.done === 'deleted'

  const picker =
    sites.length > 1 ? (
      <form action={LIBRARY_PATH} className={styles.picker} method="get">
        <label className={styles.label} htmlFor="library-site">
          Site
        </label>
        <select
          className={styles.select}
          defaultValue={site?.id ?? ''}
          id="library-site"
          name="site"
        >
          {site === null ? <option value="">Choose a site</option> : null}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className={styles.button} type="submit">
          Show its files
        </button>
      </form>
    ) : null

  if (site === null) {
    return (
      <Gutter>
        <div className={styles.library} id="file-library">
          <h1 className={styles.title}>File library</h1>
          {picker}
          <p className={styles.muted}>
            {district
              ? 'Choose a site to see its files.'
              : 'Your account is not linked to a school yet. Ask the district web team to add it.'}
          </p>
        </div>
      </Gutter>
    )
  }

  const folders = await listLibraryFolders(req, site.id)
  const folderIds = new Set(folders.map((f) => String(f.id)))
  if (at.folder !== 'all' && !folderIds.has(at.folder)) at.folder = 'all'
  const [list, file] = await Promise.all([
    listLibraryFiles(req, site.id, at, folders),
    at.file === null ? null : getLibraryFile(req, site.id, at.file, folders),
  ])
  const uses = file === null ? null : await getFileUses(req, file.id)
  const tree = folderTree(folders)
  const closeHref = libraryHref(at, { file: null })
  const folderName =
    at.folder === 'all'
      ? 'All files'
      : (folders.find((f) => String(f.id) === at.folder)?.label ?? 'All files')

  return (
    <Gutter>
      <div className={styles.library} data-file-open={file !== null} id="file-library">
        <h1 className={styles.title}>File library</h1>
        <p className={styles.muted}>
          {district ? null : `${site.name}. `}
          Choose a file to see and change it here.{' '}
          <Link href={district ? '/admin/collections/resources/create' : '/admin/upload-file'}>
            Upload a file
          </Link>
        </p>
        {picker}
        {deleted ? (
          <p className={styles.done} role="status">
            File deleted.
          </p>
        ) : null}

        <div className={styles.columns}>
          <nav aria-label="Folders" className={styles.folders}>
            <h2 className={styles.columnTitle}>Folders</h2>
            <ul className={styles.tree}>
              <li>
                <Link
                  aria-current={at.folder === 'all' ? 'page' : undefined}
                  href={libraryHref(at, { folder: 'all' })}
                >
                  All files
                </Link>
              </li>
              {tree.map((node) => (
                <FolderItem at={at} key={node.id} node={node} />
              ))}
            </ul>
          </nav>

          <section aria-labelledby="files-heading" className={styles.files}>
            <h2 className={styles.columnTitle} id="files-heading">
              {folderName}
            </h2>
            <form action={LIBRARY_PATH} className={styles.search} method="get" role="search">
              <input name="site" type="hidden" value={site.id} />
              {at.folder !== 'all' ? <input name="folder" type="hidden" value={at.folder} /> : null}
              <label className={styles.label} htmlFor="library-q">
                Search by title
              </label>
              <input
                className={styles.input}
                defaultValue={at.q}
                id="library-q"
                name="q"
                type="search"
              />
              <label className={styles.label} htmlFor="library-kind">
                Kind
              </label>
              <select
                className={styles.select}
                defaultValue={at.kind ?? ''}
                id="library-kind"
                name="kind"
              >
                <option value="">Images and documents</option>
                <option value="image">Images</option>
                <option value="document">Documents</option>
              </select>
              <button className={styles.button} type="submit">
                Search
              </button>
            </form>
            <p className={styles.count} id="library-count">
              {list.totalDocs === 1 ? '1 file' : `${list.totalDocs} files`}
            </p>
            {list.files.length === 0 ? (
              <p className={styles.muted}>No files here.</p>
            ) : (
              <ul className={styles.fileRows}>
                {list.files.map((f) => {
                  const open = file !== null && String(file.id) === String(f.id)
                  return (
                    <li className={styles.fileRow} data-open={open} key={String(f.id)}>
                      {f.kind === 'image' && f.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element -- the library's thumbnail
                        <img alt="" className={styles.thumb} src={f.thumbnail} />
                      ) : (
                        <span aria-hidden="true" className={styles.thumbDoc}>
                          {f.kind === 'image' ? 'IMG' : fileTypeLabel(f.mimeType)}
                        </span>
                      )}
                      <span className={styles.fileText}>
                        <Link
                          aria-current={open ? 'true' : undefined}
                          href={libraryHref(at, { file: String(f.id) })}
                        >
                          {f.title}
                        </Link>
                        <span className={styles.meta}>
                          {[
                            f.kind === 'image' ? 'Image' : fileTypeLabel(f.mimeType),
                            fileSizeLabel(f.filesize),
                            at.folder === 'all' ? f.folder : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            {list.totalPages > 1 ? (
              <nav aria-label="Pages of files" className={styles.pager}>
                {at.page > 1 ? (
                  <Link href={libraryHref(at, { page: at.page - 1 })}>Previous</Link>
                ) : null}
                <span>
                  Page {at.page} of {list.totalPages}
                </span>
                {at.page < list.totalPages ? (
                  <Link href={libraryHref(at, { page: at.page + 1 })}>Next</Link>
                ) : null}
              </nav>
            ) : null}
          </section>

          {file !== null ? (
            <FileDetails
              closeHref={closeHref}
              file={file}
              folders={folders.map((f) => ({ id: f.id, label: f.label }))}
              key={String(file.id)}
              usedOn={uses === null ? null : usesSummary(uses)}
              uses={uses}
            />
          ) : at.file !== null ? (
            <section aria-labelledby="file-heading" className={styles.details} id="file-details">
              <h2 className={styles.fileTitle} id="file-heading">
                File not found
              </h2>
              <p>That file isn’t in this site’s library.</p>
            </section>
          ) : null}
        </div>
      </div>
    </Gutter>
  )
}

const FolderItem = ({ node, at }: { node: FolderNode; at: LibraryParams }) => (
  <li>
    <Link
      aria-current={at.folder === node.id ? 'page' : undefined}
      href={libraryHref(at, { folder: node.id })}
    >
      {node.name}
    </Link>
    {node.children.length > 0 ? (
      <ul className={styles.tree}>
        {node.children.map((child) => (
          <FolderItem at={at} key={child.id} node={child} />
        ))}
      </ul>
    ) : null}
  </li>
)

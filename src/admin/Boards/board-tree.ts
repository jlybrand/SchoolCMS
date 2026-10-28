import { relationshipIdOf } from '@/access/predicates'

/**
 * Site → Folder → Board, for the district's boards screen (Jason, 2026-10-28: boards belong to
 * folders; a list of folders opened to pick a board). Pure; `BoardsListView` renders it.
 *
 * Everything by name, so a site's folders and a folder's boards read like a table of contents.
 * A board whose folder cannot be found is listed apart rather than dropped — `placeInFolder`
 * should make that impossible, so if it ever happens the district should see it.
 */

export type BoardNode = { id: string; name: string }
export type FolderNode = { id: string; name: string; boards: BoardNode[] }
export type SiteNode = { id: string; name: string; folders: FolderNode[] }

type Row = { id: unknown; name?: unknown }

const name = (row: Row) => (typeof row.name === 'string' ? row.name : String(row.id))
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'en')

export const boardTree = (
  sites: readonly Row[],
  folders: readonly (Row & { tenant?: unknown })[],
  boards: readonly (Row & { folder?: unknown })[],
): SiteNode[] => {
  const boardsByFolder = new Map<string, BoardNode[]>()
  for (const board of boards) {
    const folder = relationshipIdOf(board.folder as never) ?? 'unfiled'
    const list = boardsByFolder.get(folder) ?? []
    list.push({ id: String(board.id), name: name(board) })
    boardsByFolder.set(folder, list)
  }

  const known = new Set(folders.map((f) => String(f.id)))
  const tree: SiteNode[] = [...sites]
    .map((site) => ({
      id: String(site.id),
      name: name(site),
      folders: folders
        .filter((f) => relationshipIdOf(f.tenant as never) === String(site.id))
        .map((f) => ({
          id: String(f.id),
          name: name(f),
          boards: (boardsByFolder.get(String(f.id)) ?? []).sort(byName),
        }))
        .sort(byName),
    }))
    .sort(byName)

  const unfiled = [...boardsByFolder.entries()]
    .filter(([folder]) => !known.has(folder))
    .flatMap(([, list]) => list)
  if (unfiled.length > 0) {
    tree.push({
      id: 'unfiled',
      name: 'Boards with no folder',
      folders: [{ id: 'unfiled', name: 'No folder', boards: unfiled.sort(byName) }],
    })
  }
  return tree
}

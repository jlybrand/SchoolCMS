import { describe, expect, it } from 'vitest'

import { boardTree } from '@/admin/Boards/board-tree'

/**
 * The district's boards screen (Jason, 2026-10-28): Site → Folder → Board, each folder opened to
 * pick a board — boards belong to folders. Pure; the view renders it.
 */

const sites = [
  { id: 2, name: 'School A' },
  { id: 1, name: 'District' },
  { id: 3, name: 'School B' },
]
const folders = [
  { id: 10, tenant: 1, name: 'District' },
  { id: 11, tenant: 2, name: 'Athletics' },
  { id: 12, tenant: 2, name: 'School A' },
  { id: 13, tenant: { id: 2 }, name: 'PTO' },
]
const boards = [
  { id: 100, folder: 10, name: 'News' },
  { id: 101, folder: { id: 11 }, name: 'Scores' },
  { id: 102, folder: 11, name: 'Schedules' },
  { id: 103, folder: 12, name: 'News' },
]

describe('boardTree', () => {
  it('sites by name; each site’s folders by name; each folder’s boards by name', () => {
    expect(boardTree(sites, folders, boards)).toEqual([
      {
        id: '1',
        name: 'District',
        folders: [{ id: '10', name: 'District', boards: [{ id: '100', name: 'News' }] }],
      },
      {
        id: '2',
        name: 'School A',
        folders: [
          {
            id: '11',
            name: 'Athletics',
            boards: [
              { id: '102', name: 'Schedules' },
              { id: '101', name: 'Scores' },
            ],
          },
          { id: '13', name: 'PTO', boards: [] },
          { id: '12', name: 'School A', boards: [{ id: '103', name: 'News' }] },
        ],
      },
      // A site with no folders is still listed, so it is plain that it has none.
      { id: '3', name: 'School B', folders: [] },
    ])
  })

  it('a board whose folder is unknown is not dropped silently — it is listed apart', () => {
    const tree = boardTree(sites, folders, [...boards, { id: 199, folder: 999, name: 'Lost' }])
    expect(tree.at(-1)).toEqual({
      id: 'unfiled',
      name: 'Boards with no folder',
      folders: [{ id: 'unfiled', name: 'No folder', boards: [{ id: '199', name: 'Lost' }] }],
    })
  })
})

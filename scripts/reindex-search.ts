import { getPayload } from 'payload'

import { reindexSearch } from '../src/collections/search-index'
import config from '../src/payload.config'

/**
 * Rebuilds the site search index from what is published now (Phase 6 D, 2026-11-16) — for content
 * published before search existed: `dd2_dev`, and production once, at the deploy that brings it.
 *
 * `pnpm search:reindex`. Safe to re-run. Touches nothing but the index.
 */
const run = async () => {
  const payload = await getPayload({ config })
  const counts = await reindexSearch(payload)
  // console, not payload.logger: the logger writes asynchronously and `exit` can drop the line.
  console.log(`search index rebuilt: ${JSON.stringify(counts)}`)
  process.exit(0)
}

await run()

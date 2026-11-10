import { getPayload } from 'payload'

import config from '../src/payload.config'
import { composeExistingPages } from '../src/lib/compose-existing-pages'

/**
 * Every page composed (Jason, 2026-11-04): turns each page's words into a Text section at the top
 * of its sections, keeping what is live live and a school's change waiting for approval waiting.
 * The rules are `src/lib/compose-existing-pages.ts`.
 *
 * Run once per database with `pnpm run compose:pages`, BEFORE the contract step that drops `body`.
 * Safe to run again: a converted page is left alone.
 */
const run = async () => {
  if (!process.env.DATABASE_URI) throw new Error('DATABASE_URI is required.')
  if (!process.env.PAYLOAD_SECRET) throw new Error('PAYLOAD_SECRET is required.')

  const payload = await getPayload({ config })
  const { converted } = await composeExistingPages(payload)
  payload.logger.info(
    converted.length === 0
      ? 'every page was already composed'
      : `composed ${converted.length} page(s): ${converted.join(', ')}`,
  )
  process.exit(0)
}

await run()
